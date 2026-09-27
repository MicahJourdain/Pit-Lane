const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// All files sit next to this one, so the project uploads to GitHub by drag-and-drop.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'home.html'))); // game menu
app.get('/healthz', (req, res) => res.send('ok'));
// Old race-game addresses now go to Super Smash Rolls.
app.get(['/race', '/join/:code'], (req, res) => res.redirect('/smash'));
app.get('/tv', (req, res) => res.redirect('/smash/tv'));
app.get('/tv/:code', (req, res) => res.redirect('/smash/tv/' + encodeURIComponent(req.params.code)));

require('./smash-server')(app, io); // Super Smash Rolls at /smash

server.listen(PORT, () => {
  console.log(`Pit Lane is running on port ${PORT}`);
});
