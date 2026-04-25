import express from 'express';
import http from 'node:http';
import cors from 'cors';
import { Server } from 'socket.io';
import {
  createFighterState,
  resolveAction,
  applyBoostDash,
  tickFighter,
  TICK_RATE_MS
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
  fighters: {
    p1: createFighterState('p1', 360, 'nova'),
    p2: createFighterState('p2', 920, 'aegis')
  },
  startedAt: Date.now(),
  tick: 0
};

function broadcastSnapshot() {
  tickFighter(lobby.fighters.p1);
  tickFighter(lobby.fighters.p2);
  lobby.tick += 1;

  io.emit('match:snapshot', {
    tick: lobby.tick,
    serverTime: Date.now(),
    fighters: lobby.fighters
  });
}

setInterval(broadcastSnapshot, TICK_RATE_MS);

io.on('connection', (socket) => {
  const playerId = lobby.players.size === 0 ? 'p1' : 'p2';
  lobby.players.set(socket.id, playerId);

  socket.emit('player:assigned', {
    playerId,
    mode: 'online-ready'
  });

  socket.on('input:action', ({ type, direction }) => {
    const actorId = lobby.players.get(socket.id);
    if (!actorId) return;

    const defenderId = actorId === 'p1' ? 'p2' : 'p1';
    const actor = lobby.fighters[actorId];
    const defender = lobby.fighters[defenderId];

    if (type === 'BOOST_DASH') {
      applyBoostDash(actor, direction ?? actor.facing, Date.now());
      return;
    }

    resolveAction(actor, defender, type, Date.now());
  });

  socket.on('disconnect', () => {
    lobby.players.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`GVG server listening on ${PORT}`);
});
