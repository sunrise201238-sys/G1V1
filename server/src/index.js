import express from 'express';
import http from 'node:http';
import cors from 'cors';
import { Server } from 'socket.io';
import {
  createMatchState,
  resolveAction,
  applyBoostDash,
  applyBoostStep,
  applyVerticalThrust,
  tickMatch,
  TICK_RATE_MS,
  interpolateSnapshot
} from '@gvg/shared/src/gameLogic.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

const lobby = {
  players: new Map(),
  match: createMatchState(),
  previousSnapshot: null
};

function getSnapshot(now) {
  return {
    tick: lobby.match.tick,
    serverTime: now,
    fighters: lobby.match.fighters,
    projectiles: lobby.match.projectiles
  };
}

function broadcastSnapshot() {
  const now = Date.now();
  tickMatch(lobby.match, now);

  const snapshot = getSnapshot(now);
  const smoothed = interpolateSnapshot(lobby.previousSnapshot, snapshot, 0.55) ?? snapshot;
  lobby.previousSnapshot = snapshot;

  io.emit('match:snapshot', smoothed);
}

setInterval(broadcastSnapshot, TICK_RATE_MS);

io.on('connection', (socket) => {
  const playerId = lobby.players.size === 0 ? 'p1' : 'p2';
  lobby.players.set(socket.id, playerId);

  socket.emit('player:assigned', {
    playerId,
    mode: 'online-ready'
  });

  socket.on('input:action', ({ type, move, vertical }) => {
    const actorId = lobby.players.get(socket.id);
    if (!actorId) return;

    const defenderId = actorId === 'p1' ? 'p2' : 'p1';
    const actor = lobby.match.fighters[actorId];
    const defender = lobby.match.fighters[defenderId];
    const now = Date.now();

    if (type === 'BOOST_DASH') return void applyBoostDash(actor, move ?? { x: actor.facing, z: 0 }, now);
    if (type === 'BOOST_STEP') return void applyBoostStep(actor, move ?? { x: actor.facing, z: 0 }, now);
    if (type === 'VERTICAL_THRUST') return void applyVerticalThrust(actor, vertical ?? 0, now);

    resolveAction(actor, defender, type, now, lobby.match.projectiles);
  });

  socket.on('disconnect', () => {
    lobby.players.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`GVG server listening on ${PORT}`);
});
