const { SerialPort } = require('serialport');

// ESC/POS Commands
const ESC = 0x1B;
const GS = 0x1D;

const COMMANDS = {
  INIT: Buffer.from([ESC, 0x40]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_LEFT: Buffer.from([ESC, 0x61, 0x00]),
  BOLD_ON: Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([ESC, 0x45, 0x00]),
  DOUBLE_SIZE: Buffer.from([ESC, 0x21, 0x11]),
  NORMAL_SIZE: Buffer.from([ESC, 0x21, 0x00]),
  CUT: Buffer.from([GS, 0x56, 0x00]),
  LINE_FEED: Buffer.from('\n'),
};

/**
 * Bluetooth Receipt Printer Handler
 * Uses SerialPort and ESC/POS commands for 2-inch thermal printers
 */
class ReceiptPrinter {
  constructor(portPath = 'COM3', baudRate = 9600) {
    this.portPath = portPath;
    this.baudRate = baudRate;
    this.port = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.port = new SerialPort({
        path: this.portPath,
        baudRate: this.baudRate,
      });

      this.port.on('open', () => {
        console.log(`Printer connected on ${this.portPath}`);
        resolve(true);
      });

      this.port.on('error', (err) => {
        console.error('Printer error:', err.message);
        reject(err);
      });
    });
  }

  async printReceipt(receiptData) {
    if (!this.port || !this.port.isOpen) {
      await this.connect();
    }

    const {
      storeName,
      items,
      subtotal,
      tax,
      total,
      cashier,
      date,
    } = receiptData;

    const lines = [
      COMMANDS.INIT,
      COMMANDS.ALIGN_CENTER,
      COMMANDS.BOLD_ON,
      COMMANDS.DOUBLE_SIZE,
      Buffer.from(`${storeName}\n`),
      COMMANDS.NORMAL_SIZE,
      COMMANDS.BOLD_OFF,
      Buffer.from('--------------------------------\n'),
      Buffer.from(`Date: ${date}\n`),
      Buffer.from(`Cashier: ${cashier}\n`),
      Buffer.from('--------------------------------\n'),
      COMMANDS.ALIGN_LEFT,
    ];

    // Add items
    items.forEach(item => {
      const name = item.name.padEnd(20).slice(0, 20);
      const price = `$${item.price.toFixed(2)}`.padStart(10);
      lines.push(Buffer.from(`${name}${price}\n`));
    });

    lines.push(
      Buffer.from('--------------------------------\n'),
      Buffer.from(`${'Subtotal'.padEnd(20)}${`$${subtotal.toFixed(2)}`.padStart(10)}\n`),
      Buffer.from(`${'Tax'.padEnd(20)}${`$${tax.toFixed(2)}`.padStart(10)}\n`),
      COMMANDS.BOLD_ON,
      Buffer.from(`${'TOTAL'.padEnd(20)}${`$${total.toFixed(2)}`.padStart(10)}\n`),
      COMMANDS.BOLD_OFF,
      Buffer.from('--------------------------------\n'),
      COMMANDS.ALIGN_CENTER,
      Buffer.from('Thank you for your purchase!\n'),
      Buffer.from('\n\n\n'),
      COMMANDS.CUT,
    );

    return new Promise((resolve, reject) => {
      this.port.write(Buffer.concat(lines), (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  }

  disconnect() {
    if (this.port && this.port.isOpen) {
      this.port.close();
    }
  }
}

module.exports = ReceiptPrinter

/**
 * NOTE: Receipt utility functions (generateReceiptNumber, getNextReceiptCounter, formatDate, formatTime, etc.)
 * have been moved to receiptUtils.js to avoid bundling Node.js modules in the browser.
 * 
 * printerUtils.js is ONLY for use in Electron main process via IPC.
 * See receiptUtils.js for browser-safe utilities.
 */
