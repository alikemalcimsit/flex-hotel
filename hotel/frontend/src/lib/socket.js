import { io } from 'socket.io-client';
import { API_URL } from './api.js';

/** Tek socket bağlantısı. Activity Feed vb. bunu kullanır. */
export const socket = io(API_URL, { autoConnect: true });
