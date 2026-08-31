/** ESC/POS + Web Serial thermal printer adapter */

export function buildEscPosReceipt(lines: string[], header = 'TAQUILLA'): string {
  const ESC = '\x1b';
  const GS = '\x1d';
  const init = `${ESC}@`;
  const center = `${ESC}a\x01`;
  const left = `${ESC}a\x00`;
  const boldOn = `${ESC}E\x01`;
  const boldOff = `${ESC}E\x00`;
  const cut = `${GS}V\x00`;
  const body = lines.join('\n');
  const title = header.trim() || 'TAQUILLA';
  return `${init}${center}${boldOn}${title}${boldOff}\n${left}${body}\n\n${cut}`;
}

/** Cash drawer kick (pin 2, 50ms on / 50ms off) */
export function buildDrawerKick(): string {
  const ESC = '\x1b';
  return `${ESC}p\x00\x19\x19`;
}

export function printEscPos(text: string) {
  const w = window.open('', '_blank', 'width=320,height=480');
  if (!w) return;
  w.document.write(
    `<pre style="font-family:monospace;font-size:12px">${text.replace(/[\x00-\x1f]/g, '')}</pre>`,
  );
  w.print();
  w.close();
}

type SerialPortLike = {
  open: (opts: { baudRate: number }) => Promise<void>;
  writable: WritableStream<Uint8Array> | null;
  close: () => Promise<void>;
};

declare global {
  interface Navigator {
    serial?: {
      requestPort: () => Promise<SerialPortLike>;
      getPorts: () => Promise<SerialPortLike[]>;
    };
  }
}

const PORT_BAUD_KEY = 'boletera_serial_baud';

export async function connectSerialPrinter(): Promise<boolean> {
  if (!navigator.serial) return false;
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: Number(localStorage.getItem(PORT_BAUD_KEY) || 9600) });
    (window as unknown as { __boleteraPort?: SerialPortLike }).__boleteraPort = port;
    return true;
  } catch {
    return false;
  }
}

export function getSerialPort(): SerialPortLike | null {
  return (window as unknown as { __boleteraPort?: SerialPortLike }).__boleteraPort || null;
}

export async function printViaSerial(text: string, kickDrawer = true): Promise<boolean> {
  const port = getSerialPort();
  if (!port?.writable) return false;
  try {
    const writer = port.writable.getWriter();
    const encoder = new TextEncoder();
    let payload = text;
    if (kickDrawer) payload += buildDrawerKick();
    await writer.write(encoder.encode(payload));
    writer.releaseLock();
    return true;
  } catch {
    return false;
  }
}

export function isSerialSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.serial);
}
