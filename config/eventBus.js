// config/eventBus.js
const EventEmitter = require('events');

class BlogEventBus extends EventEmitter {}

const blogEventBus = new BlogEventBus();

module.exports = blogEventBus;