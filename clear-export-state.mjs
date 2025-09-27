#!/usr/bin/env node

// Script to clear stuck export state from localStorage via browser console
console.log(`
To clear the stuck export state, run this in the browser console:

// Clear all export states
localStorage.removeItem('exportState_755ddc19-47a3-4ff2-8af3-1127caaad4f0');
localStorage.removeItem('exportHistory');
localStorage.removeItem('exportActiveDownloads');

// Or clear ALL export-related items
Object.keys(localStorage).forEach(key => {
  if (key.includes('export') || key.includes('Export')) {
    console.log('Removing:', key);
    localStorage.removeItem(key);
  }
});

console.log('Export state cleared! Refresh the page.');
`);
