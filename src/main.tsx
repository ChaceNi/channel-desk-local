import React from 'react';
import {createRoot} from 'react-dom/client';
import Dashboard from './Dashboard';
import Setup from './Setup';
import Access from './Access';
import './styles.css';
createRoot(document.getElementById('root')!).render(<Access>{location.pathname==='/setup'?<Setup/>:<Dashboard/>}</Access>);
