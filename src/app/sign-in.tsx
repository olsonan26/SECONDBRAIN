"use client";
import { useState } from "react";
import { ArrowRight, BrainCircuit, LockKeyhole, LoaderCircle } from "lucide-react";

export default function SignIn() {
  const [username,setUsername]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();setBusy(true);setError("");
    try { const r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});const data=await r.json();if(!r.ok)throw new Error(data.error);window.location.assign(window.location.pathname + window.location.search); }
    catch(e){setError(e instanceof Error?e.message:"Sign-in failed. Try again.");setBusy(false);}
  }
  return <main className="login-page"><div className="login-orbit" aria-hidden="true"><div/><div/><div/><BrainCircuit size={130} strokeWidth={0.7}/></div><section className="login-panel"><a className="brand" href="/"><BrainCircuit size={28}/><span>Secondbrain<span className="brand-dot">.</span></span></a><div className="login-intro"><span className="eyebrow">A private space for shared intelligence</span><h1>Everything you know.<br/><span>Connected.</span></h1><p>Your sources, ideas, and next great article. One living library for you and your team.</p></div><form onSubmit={submit}><label htmlFor="username">Username</label><input autoComplete="username" id="username" placeholder="Your workspace username" value={username} onChange={e=>setUsername(e.target.value)} required maxLength={80}/><label htmlFor="password">Password</label><input autoComplete="current-password" type="password" id="password" placeholder="Your workspace password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={256}/>{error&&<p role="alert" className="form-error">{error}</p>}<button className="button primary" disabled={busy}>{busy?<LoaderCircle size={18} className="spin"/>:<>Enter your workspace<ArrowRight size={18}/></>}</button></form><p className="login-foot"><LockKeyhole size={14}/>Private library. Source-backed answers. Shared possibilities.</p></section></main>;
}
