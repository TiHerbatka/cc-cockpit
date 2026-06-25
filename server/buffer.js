// server/buffer.js
class RingBuffer {
  constructor(maxBytes = 256 * 1024) {
    this.maxBytes = maxBytes;
    this.data = '';
  }
  push(chunk) {
    this.data += chunk;
    if (this.data.length > this.maxBytes) {
      this.data = this.data.slice(this.data.length - this.maxBytes);
    }
  }
  getAll() {
    return this.data;
  }
}
module.exports = { RingBuffer };
