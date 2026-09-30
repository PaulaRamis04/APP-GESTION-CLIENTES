// App de gestión: clientes y suscripciones, mini asesoría y buzón de la comunidad.
// Usa el mismo Supabase que la app de finanzas; los datos solo llegan si la cuenta está en la
// tabla admins (schema_gestion.sql). La clave anónima es pública, como en js/db.js.
const SUPABASE_URL = "https://qlgtgmgtijjzqwxkhwdg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsZ3RnbWd0aWpqenF3eGtod2RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNDU1OTcsImV4cCI6MjEwNTgyMTU5N30.HZx4Sh-gic5ZG7i80utcShW_Jxwa20dATo0kdvIwoIA";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PESTANAS = [["resumen","Resumen"],["clientes","Clientes"],["asesoria","Mini asesoría"],["buzon","Buzón"]];
const PLANES = {gratis:"Gratis", premium:"Premium", asesoria:"Premium + asesoría", vencido:"Vencido"};
const TIPOS_BUZON = {idea:"Idea", fallo:"Fallo", supporter:"Supporter"};
const ESTADOS_BUZON = {nuevo:"Nuevo", en_curso:"En curso", resuelto:"Resuelto"};

let session = null;
let clientes = [], buzon = [], mensajes = [], historial = {};
let pestana = "resumen", busqueda = "", filtroCliente = "todos", clienteSel = null, chatSel = null;
let filtroTipo = "todos", filtroEstado = "pendientes";
const borradores = {}; // textos a medio escribir, por id de caja

// ── Utilidades ──
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function hoy(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function sumarDias(n){ const d = new Date(); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function fecha(s){ if(!s) return "—"; const d = new Date(s.length===10 ? s+"T12:00" : s); return d.toLocaleDateString("es-ES", {day:"numeric", month:"short", year:"numeric"}); }
function fechaHora(s){ if(!s) return ""; return new Date(s).toLocaleString("es-ES", {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"}); }
function creado(f){ return f.creado_en || f.created_at || ""; }
function mostrarError(msg){ const e = document.getElementById("err"); e.textContent = msg || ""; e.classList.toggle("ver", !!msg); }
function marca(clase, texto){ return `<span class="marca m-${clase}">${esc(texto)}</span>`; }
async function conCarga(boton, fn){
  if(boton) boton.disabled = true;
  try{ await fn(); }catch(e){ mostrarError(e.message || String(e)); }
  finally{ if(boton && document.body.contains(boton)) boton.disabled = false; }
}

// Plan que tiene ahora mismo: la suscripción manda; si no hay, el premium puesto a mano en perfiles.
function planDe(c){
  const vigente = c.plan && c.activa && (!c.hasta || c.hasta>=hoy());
  if(vigente) return c.plan;
  if(c.premium_antiguo) return "premium";
  if(c.plan && c.activa) return "vencido";
  return "gratis";
}
function nombreDe(c){ return c ? (c.nombre || c.email || "Sin nombre") : "Usuario borrado"; }
const clientePorId = id=>clientes.find(c=>c.user_id===id);
const mensajesDe = id=>mensajes.filter(m=>m.user_id===id);
const sinLeerDe = id=>mensajes.filter(m=>m.user_id===id && m.autor==="cliente" && !m.leido).length;
const buzonPendiente = ()=>buzon.filter(f=>f.estado!=="resuelto");

// ── Datos ──
async function cargar(){
  const [rc, rb, rm] = await Promise.all([
    sb.rpc("admin_clientes"),
    sb.rpc("admin_buzon"),
    sb.from("asesoria_mensajes").select("*").order("creado_en").limit(5000)
  ]);
  const fallo = rc.error || rb.error || rm.error;
  if(fallo){
    mostrarError(/does not exist|schema cache|PGRST202/i.test(fallo.message+fallo.code) ? "Falta ejecutar schema_gestion.sql en Supabase." : "No se pudieron cargar los datos: "+fallo.message);
    return false;
  }
  clientes = rc.data || [];
  buzon = (rb.data || []).sort((a,b)=>creado(b).localeCompare(creado(a)));
  mensajes = rm.data || [];
  mostrarError("");
  return true;
}
async function cargarHistorial(userId){
  const {data, error} = await sb.from("suscripciones_historial").select("*").eq("user_id", userId).order("hecho_en", {ascending:false}).limit(20);
  if(!error){ historial[userId] = data || []; render(); }
}
async function recargarYPintar(){ if(await cargar()) render(); }

// ── Pintar ──
function render(){
  document.getElementById("pestanas").innerHTML = PESTANAS.map(([k,t])=>{
    const n = k==="asesoria" ? mensajes.filter(m=>m.autor==="cliente" && !m.leido).length : k==="buzon" ? buzonPendiente().filter(f=>f.estado==="nuevo").length : 0;
    return `<button class="pestana ${k===pestana?"activa":""}" data-pestana="${k}">${t}${n ? `<span class="punto">${n}</span>` : ""}</button>`;
  }).join("");
  const c = document.getElementById("contenido");
  c.innerHTML = pestana==="clientes" ? pintarClientes() : pestana==="asesoria" ? pintarAsesoria() : pestana==="buzon" ? pintarBuzon() : pintarResumen();
  const chat = document.querySelector(".chat");
  if(chat) chat.scrollTop = chat.scrollHeight;
}

function pintarResumen(){
  const planes = clientes.map(planDe);
  const cuenta = p=>planes.filter(x=>x===p).length;
  const vencen = clientes.filter(c=>c.plan && c.activa && c.hasta && c.hasta>=hoy() && c.hasta<=sumarDias(7));
  const cifra = (n, t, ir)=>`<button class="cifra" data-ir="${ir}"><strong>${n}</strong><span>${t}</span></button>`;
  const pend = buzonPendiente();
  return `
  <div class="cifras">
    ${cifra(clientes.length, "Clientes", "clientes:todos")}
    ${cifra(cuenta("premium")+cuenta("asesoria"), "Con premium", "clientes:premium")}
    ${cifra(cuenta("asesoria"), "Con mini asesoría", "clientes:asesoria")}
    ${cifra(mensajes.filter(m=>m.autor==="cliente" && !m.leido).length, "Mensajes de asesoría sin leer", "asesoria")}
    ${cifra(pend.length, "Mensajes del buzón por resolver", "buzon")}
    ${cifra(pend.filter(f=>f.tipo==="supporter").length, "Supporters por atender", "buzon:supporter")}
  </div>
  <div class="card">
    <h2>Premium que vence en los próximos 7 días</h2>
    ${vencen.length ? `<div class="lista">${vencen.map(filaCliente).join("")}</div>` : `<p class="meta">Ninguno.</p>`}
  </div>`;
}

function filaCliente(c){
  const p = planDe(c), n = sinLeerDe(c.user_id);
  return `<button class="cliente ${clienteSel===c.user_id?"sel":""}" data-cliente="${esc(c.user_id)}">
    <span class="quien"><strong>${esc(nombreDe(c))}</strong><span class="meta">${esc(c.email||"")}</span></span>
    <span class="der">${n ? `<span class="punto" title="Mensajes de asesoría sin leer">${n}</span>` : ""}${marca(p, PLANES[p])}</span>
  </button>`;
}

function pintarClientes(){
  const q = busqueda.trim().toLowerCase();
  const lista = clientes.filter(c=>{
    const p = planDe(c);
    if(filtroCliente==="premium" && !["premium","asesoria"].includes(p)) return false;
    if(!["todos","premium"].includes(filtroCliente) && p!==filtroCliente) return false;
    return !q || (c.email||"").toLowerCase().includes(q) || (c.nombre||"").toLowerCase().includes(q);
  });
  const chips = [["todos","Todos"],["gratis","Gratis"],["premium","Premium"],["asesoria","Con asesoría"],["vencido","Vencidos"]];
  return `<div class="dos">
    <div>
      <input id="busqueda" type="search" placeholder="Buscar por nombre o email" value="${esc(busqueda)}">
      <div class="filtros">${chips.map(([k,t])=>`<button class="chip ${filtroCliente===k?"sel":""}" data-filtro-cliente="${k}">${t}</button>`).join("")}</div>
      <div class="lista">${lista.length ? lista.map(filaCliente).join("") : `<div class="vacio">No hay clientes con ese filtro.</div>`}</div>
    </div>
    <div class="lado">${pintarFicha(clientePorId(clienteSel))}</div>
  </div>`;
}

function pintarFicha(c){
  if(!c) return `<div class="card vacio">Elige un cliente para ver su ficha.</div>`;
  const p = planDe(c);
  const plan = c.plan && c.activa ? c.plan : "gratis";
  const h = historial[c.user_id];
  const suyos = buzon.filter(f=>f.user_id===c.user_id);
  return `<div class="card">
    <h2>${esc(nombreDe(c))} ${marca(p, PLANES[p])}</h2>
    <p class="meta">${esc(c.email||"")} · Alta ${fecha(c.registrado)} · Último acceso ${fecha(c.ultimo_acceso)}</p>
    ${c.premium_antiguo && !(c.plan && c.activa) ? `<p class="meta">Tiene premium activado a mano en la tabla perfiles. Si guardas un plan aquí, pasa a gestionarse desde esta app.</p>` : ""}
    <div class="grid2">
      <div><label for="fPlan">Plan</label><select id="fPlan">${["gratis","premium","asesoria"].map(k=>`<option value="${k}" ${k===plan?"selected":""}>${PLANES[k]}</option>`).join("")}</select></div>
      <div><label for="fHasta">Hasta (vacío = sin fin)</label><input id="fHasta" type="date" value="${esc(c.hasta||"")}"></div>
      <div><label for="fImporte">Aportación al mes (€)</label><input id="fImporte" type="number" min="0" step="0.5" value="${c.importe ?? ""}"></div>
      <div><label for="fNota">Nota</label><input id="fNota" value="${esc(c.nota||"")}" placeholder="Ej.: pago por Bizum"></div>
    </div>
    <div class="fila-btns" style="margin-top:12px">
      <button class="btn" data-guardar-plan="${esc(c.user_id)}">Guardar plan</button>
      ${p==="asesoria" || mensajesDe(c.user_id).length ? `<button class="btn suave" data-abrir-chat="${esc(c.user_id)}">Abrir asesoría</button>` : ""}
      ${c.email ? `<a class="btn linea" href="mailto:${esc(c.email)}">Escribir email</a>` : ""}
    </div>
  </div>
  <div class="card">
    <h2>Historial del plan</h2>
    ${!h ? `<p class="meta">Cargando…</p>` : h.length ? `<ul class="historial">${h.map(x=>`<li>${fechaHora(x.hecho_en)}: ${esc(PLANES[x.plan]||x.plan)}${x.hasta?` hasta ${fecha(x.hasta)}`:""}${x.importe!=null?` · ${esc(x.importe)} €/mes`:""}${x.nota?` · ${esc(x.nota)}`:""}</li>`).join("")}</ul>` : `<p class="meta">Sin cambios todavía.</p>`}
  </div>
  ${suyos.length ? `<div class="card"><h2>Sus mensajes en el buzón</h2><div class="lista">${suyos.map(pintarMensajeBuzon).join("")}</div></div>` : ""}`;
}

function pintarAsesoria(){
  const ids = new Set([...clientes.filter(c=>planDe(c)==="asesoria").map(c=>c.user_id), ...mensajes.map(m=>m.user_id)]);
  const ultimo = id=>{ const ms = mensajesDe(id); return ms.length ? ms[ms.length-1].creado_en : ""; };
  const lista = [...ids].sort((a,b)=>(sinLeerDe(b)-sinLeerDe(a)) || ultimo(b).localeCompare(ultimo(a)));
  if(chatSel && !ids.has(chatSel)) chatSel = null;
  const fila = id=>{
    const c = clientePorId(id), n = sinLeerDe(id), ms = mensajesDe(id), u = ms[ms.length-1];
    return `<button class="cliente ${chatSel===id?"sel":""}" data-abrir-chat="${esc(id)}">
      <span class="quien"><strong>${esc(nombreDe(c))}</strong><span class="meta">${u ? esc((u.autor==="admin"?"Tú: ":"")+u.texto.slice(0,60)) : "Sin mensajes todavía"}</span></span>
      <span class="der">${n ? `<span class="punto">${n}</span>` : ""}${c && planDe(c)!=="asesoria" ? marca("vencido","Sin plan") : ""}</span>
    </button>`;
  };
  return `<div class="dos">
    <div><div class="lista">${lista.length ? lista.map(fila).join("") : `<div class="card vacio">Aún no hay clientes con mini asesoría. Dáselo desde su ficha en Clientes.</div>`}</div></div>
    <div class="lado">${pintarChat(chatSel)}</div>
  </div>`;
}

function pintarChat(id){
  if(!id) return `<div class="card vacio">Elige una conversación.</div>`;
  const c = clientePorId(id), ms = mensajesDe(id), caja = "chat-"+id;
  return `<div class="card">
    <h2>${esc(nombreDe(c))}</h2>
    <div class="chat">${ms.length ? ms.map(m=>`<div class="burbuja ${m.autor}">${esc(m.texto)}<small>${fechaHora(m.creado_en)}${m.autor==="admin" ? (m.leido ? " · Leído" : " · Enviado") : ""}</small></div>`).join("") : `<div class="vacio">Escribe el primer mensaje para empezar la asesoría.</div>`}</div>
    <textarea id="${esc(caja)}" data-borrador="${esc(caja)}" rows="3" maxlength="4000" placeholder="Escribe tu respuesta…">${esc(borradores[caja]||"")}</textarea>
    <div class="fila-btns" style="margin-top:8px"><button class="btn" data-enviar-chat="${esc(id)}">Enviar</button></div>
  </div>`;
}

function pintarMensajeBuzon(f){
  const caja = "resp-"+f.id, estado = f.estado || "nuevo";
  const quien = f.email ? `${esc(f.nombre || f.email)}${f.nombre ? ` <span class="meta">${esc(f.email)}</span>` : ""}` : `<span class="meta">Anónimo</span>`;
  const info = f.info ? `<p class="meta">${esc(Object.entries(f.info).map(([k,v])=>`${k}: ${v}`).join(" · "))}</p>` : "";
  const c = clientePorId(f.user_id);
  const planSugerido = Number(f.importe)>=5 ? "asesoria" : "premium";
  return `<div class="mensaje">
    <div class="cab">${marca(f.tipo, TIPOS_BUZON[f.tipo]||f.tipo)} ${marca(estado, ESTADOS_BUZON[estado]||estado)} <strong>${quien}</strong> <span class="meta">${fechaHora(creado(f))}</span></div>
    ${f.tipo==="supporter" ? `<p class="texto"><strong>Quiere aportar ${esc(f.importe)} €/mes.</strong>${c ? ` Ahora tiene: ${PLANES[planDe(c)]}.` : ""}</p>` : ""}
    ${f.texto ? `<p class="texto">${esc(f.texto)}</p>` : ""}
    ${info}
    ${f.respuesta ? `<div class="respondido"><strong>Tu respuesta${f.respondido_en ? ` (${fechaHora(f.respondido_en)})` : ""}:</strong>\n${esc(f.respuesta)}</div>` : ""}
    <textarea id="${esc(caja)}" data-borrador="${esc(caja)}" rows="2" maxlength="4000" placeholder="${f.respuesta ? "Cambiar la respuesta…" : "Respuesta que verá en la app…"}">${esc(borradores[caja]||"")}</textarea>
    <div class="fila-btns">
      <button class="btn peq" data-responder="${esc(f.id)}">Responder y resolver</button>
      ${estado!=="en_curso" ? `<button class="btn linea peq" data-estado="${esc(f.id)}" data-valor="en_curso">En curso</button>` : ""}
      ${estado!=="resuelto" ? `<button class="btn linea peq" data-estado="${esc(f.id)}" data-valor="resuelto">Resolver sin responder</button>` : `<button class="btn linea peq" data-estado="${esc(f.id)}" data-valor="nuevo">Reabrir</button>`}
      ${f.tipo==="supporter" && c ? `<button class="btn suave peq" data-activar="${esc(f.user_id)}" data-plan="${planSugerido}" data-importe="${esc(f.importe ?? "")}">Activar ${PLANES[planSugerido]}</button>` : ""}
      ${f.email ? `<a class="btn linea peq" href="mailto:${esc(f.email)}">Email</a>` : ""}
      ${f.user_id && pestana!=="clientes" ? `<button class="btn linea peq" data-cliente="${esc(f.user_id)}" data-ir-ficha="1">Ver ficha</button>` : ""}
    </div>
  </div>`;
}

function pintarBuzon(){
  const lista = buzon.filter(f=>(filtroTipo==="todos" || f.tipo===filtroTipo) && (filtroEstado==="todos" || (filtroEstado==="pendientes") === (f.estado!=="resuelto")));
  const chipsTipo = [["todos","Todo"],["idea","Ideas"],["fallo","Fallos"],["supporter","Supporters"]];
  const chipsEstado = [["pendientes","Por resolver"],["resueltos","Resueltos"],["todos","Todos"]];
  return `
  <div class="filtros">${chipsTipo.map(([k,t])=>`<button class="chip ${filtroTipo===k?"sel":""}" data-filtro-tipo="${k}">${t}</button>`).join("")}</div>
  <div class="filtros">${chipsEstado.map(([k,t])=>`<button class="chip ${filtroEstado===k?"sel":""}" data-filtro-estado="${k}">${t}</button>`).join("")}</div>
  <div class="lista">${lista.length ? lista.map(pintarMensajeBuzon).join("") : `<div class="card vacio">No hay mensajes aquí. 🌸</div>`}</div>`;
}

// ── Acciones ──
function elegirCliente(id){
  clienteSel = id; pestana = "clientes";
  if(!historial[id]) cargarHistorial(id);
  render();
}
async function abrirChat(id){
  chatSel = id; pestana = "asesoria"; render();
  const sinLeer = mensajes.filter(m=>m.user_id===id && m.autor==="cliente" && !m.leido);
  if(!sinLeer.length) return;
  const {error} = await sb.from("asesoria_mensajes").update({leido:true}).eq("user_id", id).eq("autor", "cliente").eq("leido", false);
  if(!error){ sinLeer.forEach(m=>{ m.leido = true; }); render(); }
}
async function guardarPlan(id){
  const plan = document.getElementById("fPlan").value;
  const importe = document.getElementById("fImporte").value;
  const {error} = await sb.rpc("admin_set_suscripcion", {
    p_user:id, p_plan:plan, p_hasta:document.getElementById("fHasta").value || null,
    p_importe:importe==="" ? null : Number(importe), p_nota:document.getElementById("fNota").value.trim() || null
  });
  if(error) throw new Error("No se pudo guardar el plan: "+error.message);
  delete historial[id];
  await cargar(); cargarHistorial(id); render();
}
async function activarPlan(id, plan, importe){
  const c = clientePorId(id);
  if(!confirm(`¿Activar ${PLANES[plan]} a ${nombreDe(c)}?`)) return;
  const {error} = await sb.rpc("admin_set_suscripcion", {p_user:id, p_plan:plan, p_hasta:null, p_importe:importe==="" ? null : Number(importe), p_nota:c?.nota || null});
  if(error) throw new Error("No se pudo activar: "+error.message);
  delete historial[id];
  await recargarYPintar();
}
async function enviarChat(id){
  const caja = "chat-"+id, texto = (document.getElementById(caja)?.value || "").trim();
  if(!texto){ mostrarError("Escribe un mensaje antes de enviarlo."); return; }
  const {error} = await sb.from("asesoria_mensajes").insert({user_id:id, autor:"admin", texto});
  if(error) throw new Error("No se pudo enviar: "+error.message);
  delete borradores[caja]; mostrarError("");
  await recargarYPintar();
}
async function responder(id){
  const caja = "resp-"+id, texto = (document.getElementById(caja)?.value || "").trim();
  if(!texto){ mostrarError("Escribe la respuesta antes de enviarla."); return; }
  const {error} = await sb.from("comunidad").update({respuesta:texto, respondido_en:new Date().toISOString(), estado:"resuelto"}).eq("id", id);
  if(error) throw new Error("No se pudo guardar la respuesta: "+error.message);
  delete borradores[caja]; mostrarError("");
  await recargarYPintar();
}
async function cambiarEstado(id, estado){
  const {error} = await sb.from("comunidad").update({estado}).eq("id", id);
  if(error) throw new Error("No se pudo cambiar el estado: "+error.message);
  await recargarYPintar();
}

function wire(){
  document.getElementById("pestanas").addEventListener("click", e=>{
    const b = e.target.closest("[data-pestana]"); if(!b) return;
    pestana = b.dataset.pestana; render();
  });
  const cont = document.getElementById("contenido");
  cont.addEventListener("input", e=>{
    if(e.target.id==="busqueda"){
      busqueda = e.target.value;
      const pos = e.target.selectionStart; render();
      const b = document.getElementById("busqueda"); b.focus(); b.setSelectionRange(pos, pos);
    }
    if(e.target.dataset.borrador) borradores[e.target.dataset.borrador] = e.target.value;
  });
  cont.addEventListener("click", e=>{
    const t = e.target.closest("button"); if(!t) return;
    const d = t.dataset;
    if(d.ir){ const [p, f] = d.ir.split(":"); pestana = p; if(p==="clientes") filtroCliente = f; if(p==="buzon"){ filtroTipo = f || "todos"; filtroEstado = "pendientes"; } render(); }
    else if(d.filtroCliente){ filtroCliente = d.filtroCliente; render(); }
    else if(d.filtroTipo){ filtroTipo = d.filtroTipo; render(); }
    else if(d.filtroEstado){ filtroEstado = d.filtroEstado; render(); }
    else if(d.cliente) elegirCliente(d.cliente);
    else if(d.abrirChat) abrirChat(d.abrirChat);
    else if(d.guardarPlan) conCarga(t, ()=>guardarPlan(d.guardarPlan));
    else if(d.enviarChat) conCarga(t, ()=>enviarChat(d.enviarChat));
    else if(d.responder) conCarga(t, ()=>responder(d.responder));
    else if(d.estado) conCarga(t, ()=>cambiarEstado(d.estado, d.valor));
    else if(d.activar) conCarga(t, ()=>activarPlan(d.activar, d.plan, d.importe));
  });
  document.getElementById("btnRecargar").onclick = e=>conCarga(e.currentTarget, recargarYPintar);
  document.getElementById("btnSalir").onclick = ()=>sb.auth.signOut();
  document.getElementById("fAcceso").onsubmit = async e=>{
    e.preventDefault();
    const msg = document.getElementById("accesoMsg"); msg.textContent = "";
    const {error} = await sb.auth.signInWithPassword({email:document.getElementById("accEmail").value.trim(), password:document.getElementById("accPass").value});
    if(error) msg.textContent = /invalid login/i.test(error.message) ? "Email o contraseña incorrectos." : error.message;
  };
  // Refresco suave cada minuto, sin interrumpir si se está escribiendo.
  setInterval(async ()=>{
    if(!session || document.visibilityState!=="visible") return;
    const ae = document.activeElement;
    if(ae && ["INPUT","TEXTAREA","SELECT"].includes(ae.tagName)) return;
    await recargarYPintar();
  }, 60000);
}

async function entrar(s){
  session = s;
  document.getElementById("pantallaAcceso").hidden = !!s;
  document.getElementById("pantallaApp").hidden = !s;
  if(!s) return;
  document.getElementById("quien").textContent = s.user.email;
  const {data:esAdmin, error} = await sb.rpc("es_admin");
  if(error || esAdmin!==true){
    document.getElementById("pestanas").innerHTML = "";
    document.getElementById("contenido").innerHTML = `<div class="card"><h2>Esta cuenta no es administradora</h2>
      <p class="meta">${error ? "Falta ejecutar schema_gestion.sql en Supabase." : "Añádela a la tabla admins en Supabase (como al final de schema_gestion.sql)."}</p></div>`;
    return;
  }
  render();
  await recargarYPintar();
}

(async ()=>{
  wire();
  const {data:{session:s}} = await sb.auth.getSession();
  await entrar(s);
  sb.auth.onAuthStateChange((_ev, s2)=>{ if((s2?.user?.id) !== (session?.user?.id)) entrar(s2); });
})();
