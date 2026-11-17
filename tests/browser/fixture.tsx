import App from '../../src/App';
import {mountFixture} from './bootstrap';
import React,{useState,useEffect} from 'react';
import LoginScreen from '../../src/components/LoginScreen';
import TabKnowledgeBase from '../../src/components/config/TabKnowledgeBase';
import * as auth from '../../src/lib/db';
import {DEFAULT_CONFIG} from '../../src/lib/defaultData';
function AuthFixture(){
 const [session,setSession]=useState(auth.getAuthSession);
 useEffect(()=>{void auth.refreshStoredAuthSession().then(value=>{if(value)setSession(value);});},[]);
 if(session)return <main><p>{session.user.email}</p><button onClick={()=>void auth.logout().then(()=>setSession(null))}>Logout fixture</button></main>;
 return <LoginScreen onLogin={async(email,password)=>setSession(await auth.login(email,password))} onSignUp={auth.signUp} onForgotPassword={auth.requestPasswordReset} onResetPassword={auth.resetPassword}/>;
}
function LibraryFixture(){
 const [files,setFiles]=useState<any[]>([]);
 const [config,setConfig]=useState(DEFAULT_CONFIG);
 return <main><TabKnowledgeBase files={files} onChange={setFiles} railwayUrl="http://127.0.0.1:4173" config={config} onConfigChange={setConfig}/><pre data-testid="library-records">{JSON.stringify(files)}</pre><pre data-testid="library-access">{JSON.stringify(config.stepConfigs[4].fileAccess)}</pre></main>;
}
const query=new URLSearchParams(location.search);
mountFixture(query.has('app-auth')?<App/>:query.has('auth')?<AuthFixture/>:<LibraryFixture/>);
