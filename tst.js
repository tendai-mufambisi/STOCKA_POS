const { SerialPort } = require('serialport');

const port = new SerialPort({
  path: 'COM3', // change if needed
  baudRate: 9600,
});

port.on('open', () => {
  console.log('Port opened');

  port.write('Hello Printer!\n', (err) => {
    if (err) {
      return console.error('Write error:', err.message);
    }
    console.log('Message sent');
  });
});

port.on('error', (err) => {
  console.error('Error:', err.message);
});