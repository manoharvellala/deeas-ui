import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../lib/api';

export default function Hotels() {
  const [hotels, setHotels] = useState([]);
  const [form, setForm] = useState({ name: '', location: '' });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    try {
      const data = await http('/hotels');
      setHotels(data || []);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e) {
    e.preventDefault();
    if (!form.name || !form.location) return;
    setLoading(true);
    try {
      await http('/hotels', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', location: '' });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className='section'>
      <h2>Hotels</h2>

      <form className='card row' onSubmit={onCreate}>
        <div className='row'>
          <label className='field'>
            <span>Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className='field'>
            <span>Location</span>
            <input
              value={form.location}
              onChange={(e) =>
                setForm((f) => ({ ...f, location: e.target.value }))
              }
            />
          </label>
        </div>
        <div>
          <button className='btn' disabled={loading}>
            Create Hotel
          </button>
        </div>
        {err && <div className='error'>{err}</div>}
      </form>

      <div className='card'>
        <table className='table'>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Location</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {hotels.map((h) => (
              <tr key={h.id}>
                <td>{h.id}</td>
                <td>{h.name}</td>
                <td>{h.location}</td>
                <td>
                  <Link to={`/hotels/${h.id}`} className='link'>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {!hotels.length && (
              <tr>
                <td colSpan='4' className='muted'>
                  No hotels yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
