"use client";
export default function ErrorPage({reset}:{error:Error;reset:()=>void}) { return <main style={{padding:64,color:"#eef3ff",background:"#080b16",minHeight:"100vh",fontFamily:"sans-serif"}}><h1>Your workspace needs a moment</h1><p>The private library could not be loaded. Check the storage connection, then try again.</p><button onClick={reset}>Try again</button></main>; }
