import { mountC3 } from './bootstrap';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found.');
}

mountC3(root);