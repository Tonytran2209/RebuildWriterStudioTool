import App from '../../src/App';
import {mountFixture} from './bootstrap';
import React,{useState,useEffect} from 'react';
import LoginScreen from '../../src/components/LoginScreen';
import { AddDocForm } from '../../src/crm/StorageDocs';
import * as auth from '../../src/lib/db';
function AuthFixture(){
 const [session,setSession]=useState(auth.getAuthSession);
 useEffect(()=>{void auth.refreshStoredAuthSession().then(value=>{if(value)setSession(value);});},[]);
 if(session)return <main><p>{session.user.email}</p><button onClick={()=>void auth.logout().then(()=>setSession(null))}>Logout fixture</button></main>;
 return <LoginScreen onLogin={async(email,password)=>setSession(await auth.login(email,password))} onSignUp={auth.signUp} onForgotPassword={auth.requestPasswordReset} onResetPassword={auth.resetPassword}/>;
}
function LibraryFixture(){
 const [files,setFiles]=useState<any[]>([]);
 return <main className="crm"><AddDocForm railwayUrl="http://127.0.0.1:4173" onAdded={async docs=>setFiles(current=>[...docs,...current])}/><pre data-testid="library-records">{JSON.stringify(files)}</pre></main>;
}
const query=new URLSearchParams(location.search);
mountFixture(query.has('app-auth')?<App/>:query.has('auth')?<AuthFixture/>:<LibraryFixture/>);
