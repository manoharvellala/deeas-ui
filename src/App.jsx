import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import './App.css';

export default function App() {
  return (
    <div className='app'>
      <header className='app__header'>
        <Link to='/' className='brand'>
          DEaaS Dashboard
        </Link>
      </header>
      <main className='app__main'>
        <Outlet />
      </main>
      <footer className='app__footer'></footer>
    </div>
  );
}
