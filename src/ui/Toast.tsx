import { useEffect, useState } from 'react';
import { onToast } from './state';

export function Toast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const off = onToast((m) => { setMsg(m); clearTimeout(t); t = setTimeout(() => setMsg(null), 1800); });
    return () => { off(); clearTimeout(t); };
  }, []);
  return msg ? <div id="toast">{msg}</div> : null;
}
