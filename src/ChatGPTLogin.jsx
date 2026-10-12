import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, LoaderCircle } from 'lucide-react';

export default function ChatGPTLogin({socket, reload, notify, disabled}) {
  const [login,setLogin]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const current = useRef(null), mounted = useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>socket?.subscribe(msg=>{
    const event=msg.event;
    if(event?.method!=='account/login/completed'||event.params?.loginId!==current.current?.loginId)return;
    current.current=null;setLogin(null);setMessage(event.params.success?'ChatGPT 账号已连接':event.params.error||'授权未完成，请重试');
    reload();if(event.params.success)notify('ChatGPT 账号已连接');
  }),[socket]);
  async function start() {
    setBusy(true);setMessage('');
    try {const result=await socket.call('account/login/start',{type:'chatgptDeviceCode'});const url=new URL(result.verificationUrl);
      if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com','auth.chatgpt.com'].includes(url.hostname)||!result.userCode||!result.loginId)throw new Error('登录接口返回了无效的授权信息');
      current.current=result;if(mounted.current)setLogin(result);
    }catch(e){if(mounted.current)setMessage(e.message);}finally{if(mounted.current)setBusy(false);}
  }
  async function cancel() {setBusy(true);try{await socket.call('account/login/cancel',{loginId:login.loginId});current.current=null;setLogin(null);setMessage('已取消登录');}catch(e){notify(e.message,true);}finally{setBusy(false);}}
  return <div className="chatgpt-login"><p className="field-hint">在网页发起设备登录，再到官方授权页输入验证码。完成后此工作区会自动连接你的 ChatGPT 账号。</p>
    {login ? <div className="device-login"><span>一次性验证码</span><div><code>{login.userCode}</code><button type="button" aria-label="复制登录验证码" onClick={()=>navigator.clipboard.writeText(login.userCode).then(()=>notify('验证码已复制')).catch(()=>notify('请手动复制验证码',true))}><Copy size={15}/></button></div><a className="primary" href={login.verificationUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>打开官方授权页</a><p><LoaderCircle className="spin" size={13}/>等待授权完成…</p><button type="button" className="text-button" disabled={busy} onClick={cancel}>取消登录</button></div> : <button type="button" className="secondary full" disabled={disabled||busy} onClick={start}>{busy?<LoaderCircle className="spin" size={15}/>:<ExternalLink size={15}/>}使用 ChatGPT 账号登录</button>}
    {message&&<p className="field-hint" role="status">{message}</p>}
  </div>;
}
