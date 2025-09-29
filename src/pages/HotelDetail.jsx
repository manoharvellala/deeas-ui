import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { http } from '../lib/api';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import './dashboard.css';

const POLL_MS = 5000;

// tiny helpers for tidy logs
const ts = () => new Date().toLocaleTimeString();
const group = (label) => {
  try {
    console.groupCollapsed(label);
  } catch {}
  return () => {
    try {
      console.groupEnd();
    } catch {}
  };
};

export default function HotelDetail() {
  const { id } = useParams();
  const [hotel, setHotel] = useState(null);
  const [err, setErr] = useState('');
  const [togglingId, setTogglingId] = useState(null);

  // Battery SOC (use refs to avoid re-render loops)
  const [socWh, setSocWh] = useState(0);
  const lastTickRef = useRef(null);
  const seededRef = useRef(false);

  // forms
  const [pForm, setPForm] = useState({
    name: '',
    voltage: '',
    current: '',
    power: '',
    thermal_power: '',
  });
  const [iForm, setIForm] = useState({
    enabled: true,
    total_power: '',
    ac_output: '',
    fault: false,
  });
  const [tForm, setTForm] = useState({ temperature: '', thermal_input: '' });

  async function load() {
    setErr('');
    const end = group(`🔵 GET /hotels/${id} @ ${ts()}`);
    try {
      const data = await http(`/hotels/${id}`);

      // ---- Battery integration happens here (no effects) ----
      const now = Date.now();
      const capacityWhFetched = Number(data?.battery_capacity || 0);
      const demandWFetched = Number(data?.demand || 0);
      const totalInverterACFetched = (data?.inverters || []).reduce(
        (s, inv) => s + Number(inv?.ac_output || 0),
        0
      );
      const netWFetched = totalInverterACFetched - demandWFetched; // +ve = charging

      if (capacityWhFetched > 0) {
        if (!seededRef.current) {
          setSocWh((prev) =>
            prev > 0 ? prev : Math.max(1, capacityWhFetched * 0.5)
          );
          seededRef.current = true;
          lastTickRef.current = now;
        } else if (lastTickRef.current != null) {
          const dtHours = (now - lastTickRef.current) / 3_600_000;
          if (dtHours > 0 && Number.isFinite(netWFetched)) {
            setSocWh((prev) =>
              clamp((prev || 0) + netWFetched * dtHours, 0, capacityWhFetched)
            );
            lastTickRef.current = now;
          } else {
            lastTickRef.current = now;
          }
        } else {
          lastTickRef.current = now;
        }
      } else {
        seededRef.current = false;
        lastTickRef.current = now;
        setSocWh(0);
      }
      // -------------------------------------------------------

      setHotel(data);
    } catch (e) {
      setErr(e.message || 'Failed to load');
    } finally {
      end();
    }
  }

  useEffect(() => {
    // reset integrator when switching hotels
    seededRef.current = false;
    lastTickRef.current = null;
    setSocWh(0);
    load();
  }, [id]);

  // Poll every 5 seconds
  useEffect(() => {
    const t = setInterval(() => {
      const end = group(`🕘 Poll /hotels/${id} @ ${ts()}`);
      load().finally(end);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [id]);

  // derived values
  const totalPanelPower = useMemo(
    () => (hotel?.panels || []).reduce((s, p) => s + Number(p.power || 0), 0),
    [hotel]
  );
  const totalInverterAC = useMemo(
    () =>
      (hotel?.inverters || []).reduce(
        (s, inv) => s + Number(inv.ac_output || 0),
        0
      ),
    [hotel]
  );

  const capacityWh = Number(hotel?.battery_capacity || 0);
  const demandW = Number(hotel?.demand || 0);
  const netW = useMemo(
    () => totalInverterAC - demandW,
    [totalInverterAC, demandW]
  );
  const socPct = capacityWh ? Math.round((socWh / capacityWh) * 100) : 0;

  async function addPanel(e) {
    e.preventDefault();
    const body = { hotel_id: Number(id), ...numify(pForm) };
    try {
      await http('/panels', { method: 'POST', body: JSON.stringify(body) });
      setPForm({
        name: '',
        voltage: '',
        current: '',
        power: '',
        thermal_power: '',
      });
      await load();
    } catch (e2) {
      setErr(e2.message || 'Failed to add panel');
    }
  }

  async function addInverter(e) {
    e.preventDefault();
    const body = { hotel_id: Number(id), ...numify(iForm) };
    try {
      await http('/inverters', { method: 'POST', body: JSON.stringify(body) });
      setIForm({ enabled: true, total_power: '', ac_output: '', fault: false });
      await load();
    } catch (e2) {
      setErr(e2.message || 'Failed to add inverter');
    }
  }

  async function addTank(e) {
    e.preventDefault();
    const body = { hotel_id: Number(id), ...numify(tForm) };
    try {
      await http('/tanks', { method: 'POST', body: JSON.stringify(body) });
      setTForm({ temperature: '', thermal_input: '' });
      await load();
    } catch (e2) {
      setErr(e2.message || 'Failed to add tank');
    }
  }

  // Panel ON/OFF toggle (kept as your 0/1 payload)
  async function togglePanel(panel) {
    const payload = { enabled: panel.enabled ? 0 : 1 };
    try {
      setTogglingId(panel.id);
      await http(`/panels/${panel.id}/power`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await load();
    } catch (e2) {
      setErr(e2.message || 'Failed to toggle panel');
    } finally {
      setTogglingId(null);
    }
  }

  if (!hotel)
    return (
      <div className='section'>
        <p className='loading'>Loading…</p>
        {err && <div className='error'>{err}</div>}
      </div>
    );

  return (
    <div className='section'>
      <div className='breadcrumb'>
        <Link to='/' className='breadcrumb__link'>
          ← Hotels
        </Link>
      </div>

      <h2 className='title'>
        {hotel.name} <span className='muted'>({hotel.location})</span>
      </h2>

      <div className='grid2'>
        {/* STATS CARD */}
        <div className='card stats'>
          <div className='stat'>
            <b>Panels:</b> {(hotel.panels ?? []).length}
          </div>
          <div className='stat'>
            <b>Inverters:</b> {(hotel.inverters ?? []).length}
          </div>
          <div className='stat'>
            <b>Tanks:</b> {(hotel.tanks ?? []).length}
          </div>
          <div className='stat'>
            <b>Sum Panel Power:</b> {fmtKw(totalPanelPower)}
          </div>
          <div className='stat'>
            <b>Sum Inverter AC:</b> {fmtKw(totalInverterAC)}
          </div>

          <div className='stat stat--span'>
            <b>Battery Capacity:</b> {fmtKWh(capacityWh)}
          </div>
          <div className='stat'>
            <b>SOC:</b> {fmtKWh(socWh)} ({socPct}%)
          </div>
          <div className='stat'>
            <b>Demand:</b> {num(demandW)} W
          </div>
          <div className='stat'>
            <b>Net Power:</b> {num(netW)} W{' '}
            {netW >= 0 ? 'charging' : 'discharging'}
          </div>

          <div className='stat stat--span'>
            <BatteryBar socWh={socWh} capacityWh={capacityWh} />
          </div>
          <div className='stat stat--span'>
            <small className='muted'>{etaText(socWh, capacityWh, netW)}</small>
          </div>

          {err && <div className='error stat--span'>{err}</div>}
        </div>

        {/* CHART CARD */}
        <div className='card'>
          <h3 className='card__title'>Plant Output (demo chart)</h3>
          <div className='chart'>
            <ResponsiveContainer width='100%' height='100%'>
              <LineChart
                data={(hotel.panels || []).map((p) => ({
                  name: p.name,
                  kW: Number(p.power || 0) / 1000,
                }))}
              >
                <XAxis dataKey='name' tick={{ fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fill: 'var(--text-muted)' }} />
                <Tooltip />
                <Line
                  type='monotone'
                  dataKey='kW'
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* PANELS */}
      <div className='card'>
        <div className='card__header'>
          <h3 className='card__title'>Panels</h3>
          <form className='row' onSubmit={addPanel}>
            <input
              className='input'
              placeholder='Name'
              value={pForm.name}
              onChange={(e) =>
                setPForm((f) => ({ ...f, name: e.target.value }))
              }
              required
            />
            <input
              className='input'
              placeholder='Voltage (V)'
              value={pForm.voltage}
              onChange={(e) =>
                setPForm((f) => ({ ...f, voltage: e.target.value }))
              }
            />
            <input
              className='input'
              placeholder='Current (A)'
              value={pForm.current}
              onChange={(e) =>
                setPForm((f) => ({ ...f, current: e.target.value }))
              }
            />
            <input
              className='input'
              placeholder='Power (W)'
              value={pForm.power}
              onChange={(e) =>
                setPForm((f) => ({ ...f, power: e.target.value }))
              }
            />
            <input
              className='input'
              placeholder='Thermal (W)'
              value={pForm.thermal_power}
              onChange={(e) =>
                setPForm((f) => ({ ...f, thermal_power: e.target.value }))
              }
            />
            <button className='btn'>Add Panel</button>
          </form>
        </div>

        <div className='table__wrap'>
          <table className='table'>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>V</th>
                <th>A</th>
                <th>Power (W)</th>
                <th>Thermal (W)</th>
                <th>Enabled</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(hotel.panels || []).map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td className='mono'>{p.name}</td>
                  <td>{num(p.voltage)}</td>
                  <td>{num(p.current)}</td>
                  <td>{num(p.power)}</td>
                  <td>{num(p.thermal_power)}</td>
                  <td>{p.enabled ? 'ON' : 'OFF'}</td>
                  <td>
                    <button
                      className='btn btn--secondary'
                      onClick={() => togglePanel(p)}
                      disabled={togglingId === p.id}
                      title='Toggle panel power'
                    >
                      {togglingId === p.id
                        ? 'Working…'
                        : p.enabled
                        ? 'Turn OFF'
                        : 'Turn ON'}
                    </button>
                  </td>
                </tr>
              ))}
              {!(hotel.panels || []).length && (
                <tr>
                  <td colSpan='8' className='muted center'>
                    No panels yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* INVERTERS */}
      <div className='card'>
        <div className='card__header'>
          <h3 className='card__title'>Inverters</h3>
          <form className='row' onSubmit={addInverter}>
            <label className='chk'>
              <input
                type='checkbox'
                checked={iForm.enabled}
                onChange={(e) =>
                  setIForm((f) => ({ ...f, enabled: e.target.checked }))
                }
              />
              <span>Enabled</span>
            </label>
            <input
              className='input'
              placeholder='Total Power (W)'
              value={iForm.total_power}
              onChange={(e) =>
                setIForm((f) => ({ ...f, total_power: e.target.value }))
              }
            />
            <input
              className='input'
              placeholder='AC Output (W)'
              value={iForm.ac_output}
              onChange={(e) =>
                setIForm((f) => ({ ...f, ac_output: e.target.value }))
              }
            />
            <label className='chk'>
              <input
                type='checkbox'
                checked={iForm.fault}
                onChange={(e) =>
                  setIForm((f) => ({ ...f, fault: e.target.checked }))
                }
              />
              <span>Fault</span>
            </label>
            <button className='btn'>Add Inverter</button>
          </form>
        </div>

        <div className='table__wrap'>
          <table className='table'>
            <thead>
              <tr>
                <th>ID</th>
                <th>Enabled</th>
                <th>Total Power (W)</th>
                <th>AC Output (W)</th>
                <th>Fault</th>
              </tr>
            </thead>
            <tbody>
              {(hotel.inverters || []).map((i) => (
                <tr key={i.id}>
                  <td>{i.id}</td>
                  <td>{i.enabled ? 'Yes' : 'No'}</td>
                  <td>{num(i.total_power)}</td>
                  <td>{num(i.ac_output)}</td>
                  <td>{i.fault ? 'Yes' : 'No'}</td>
                </tr>
              ))}
              {!(hotel.inverters || []).length && (
                <tr>
                  <td colSpan='5' className='muted center'>
                    No inverters yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* TANKS */}
      <div className='card'>
        <div className='card__header'>
          <h3 className='card__title'>Tanks</h3>
          <form className='row' onSubmit={addTank}>
            <input
              className='input'
              placeholder='Temperature (°C)'
              value={tForm.temperature}
              onChange={(e) =>
                setTForm((f) => ({ ...f, temperature: e.target.value }))
              }
            />
            <input
              className='input'
              placeholder='Thermal Input (W)'
              value={tForm.thermal_input}
              onChange={(e) =>
                setTForm((f) => ({ ...f, thermal_input: e.target.value }))
              }
            />
            <button className='btn'>Add Tank</button>
          </form>
        </div>

        <div className='table__wrap'>
          <table className='table'>
            <thead>
              <tr>
                <th>ID</th>
                <th>Temp (°C)</th>
                <th>Thermal Input (W)</th>
              </tr>
            </thead>
            <tbody>
              {(hotel.tanks || []).map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>{num(t.temperature)}</td>
                  <td>{num(t.thermal_input)}</td>
                </tr>
              ))}
              {!(hotel.tanks || []).length && (
                <tr>
                  <td colSpan='3' className='muted center'>
                    No tanks yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* Helpers */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}
function fmtKw(watts) {
  const n = Number(watts) || 0;
  return `${(n / 1000).toFixed(2)} kW`;
}
function fmtKWh(wh) {
  const n = Number(wh) || 0;
  return `${(n / 1000).toFixed(2)} kWh`;
}
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
function etaText(socWh, capacityWh, netW) {
  if (!capacityWh || !Number.isFinite(netW) || netW === 0)
    return 'Stable (no net flow).';
  if (netW > 0) {
    const remainingWh = Math.max(0, capacityWh - socWh);
    const hrs = remainingWh / netW;
    return `~${fmtHrs(hrs)} to full at current rate.`;
  } else {
    const hrs = (socWh || 0) / Math.abs(netW);
    return `~${fmtHrs(hrs)} to empty at current rate.`;
  }
}
function fmtHrs(h) {
  if (!Number.isFinite(h) || h < 0) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 24) return `${h.toFixed(1)} h`;
  const d = Math.floor(h / 24);
  const rem = h - d * 24;
  return `${d} d ${Math.round(rem)} h`;
}
function numify(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '' || v === null || v === undefined) {
      out[k] = v;
      continue;
    }
    if (typeof v === 'boolean') {
      out[k] = v;
      continue;
    }
    const n = Number(v);
    out[k] = Number.isFinite(n) ? n : v;
  }
  return out;
}

// Battery bar
function BatteryBar({ socWh, capacityWh }) {
  const pct = capacityWh
    ? Math.max(0, Math.min(100, (socWh / capacityWh) * 100))
    : 0;
  return (
    <div className='battery'>
      <div className='battery__fill' style={{ width: `${pct}%` }} />
    </div>
  );
}
