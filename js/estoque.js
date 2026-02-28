import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let usernameDB = "Usuário";
let userRole = "leitor";

// --- CONTROLE DE ACESSO ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || "Usuário";
            userRole = data.role || "leitor";
            
            // EXIBIÇÃO DO BOTÃO DE ENDEREÇO (Apenas Admin)
            const btnEnd = document.getElementById("btnNovoEnd");
            if(btnEnd) {
                btnEnd.style.display = (userRole === 'admin') ? 'block' : 'none';
            }
        }
        const display = document.getElementById("userDisplay");
        if(display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB} (${userRole.toUpperCase()})`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    try {
        const [fSnap, pSnap, eSnap, vSnap] = await Promise.all([
            getDocs(collection(db, "fornecedores")),
            getDocs(collection(db, "produtos")),
            getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo"))),
            getDocs(collection(db, "volumes"))
        ]);

        dbState.fornecedores = {};
        fSnap.forEach(d => dbState.fornecedores[d.id] = { nome: d.data().nome });
        dbState.produtos = {};
        pSnap.forEach(d => dbState.produtos[d.id] = { nome: d.data().nome, codigo: d.data().codigo || "S/C", fornecedorId: d.data().fornecedorId });
        dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        syncUI();
    } catch (e) { console.error("Erro ao carregar dados:", e); }
}

function syncUI() {
    const grid = document.getElementById("gridEnderecos");
    const pendentes = document.getElementById("listaPendentes");
    if(!grid || !pendentes) return;

    grid.innerHTML = "";
    pendentes.innerHTML = "";

    // LISTA PENDENTES
    const falta = dbState.volumes.filter(v => (!v.enderecoId || v.enderecoId === "") && v.quantidade > 0);
    document.getElementById("countPendentes").innerText = falta.length;

    falta.forEach(v => {
        const prod = dbState.produtos[v.produtoId] || { nome: "???", codigo: "???" };
        const div = document.createElement("div");
        div.className = "item-pendente";
        div.innerHTML = `
            <span><b>P: ${prod.codigo}</b></span><br>
            <span>${v.descricao}</span><br>
            <small>Qtd: ${v.quantidade}</small>
            ${userRole !== 'leitor' ? `<button onclick="window.abrirAcao('${v.id}', 'guardar')" class="btn" style="background:var(--success); color:white; width:100%; margin-top:5px; font-size:10px;">GUARDAR</button>` : ''}
        `;
        pendentes.appendChild(div);
    });

    // GRID DE ENDEREÇOS
    dbState.enderecos.forEach(e => {
        const vols = dbState.volumes.filter(v => v.enderecoId === e.id && v.quantidade > 0);
        const card = document.createElement("div");
        card.className = "card-endereco";
        let htmlItens = "";
        let buscaTexto = `${e.rua} ${e.modulo} ${e.nivel} `.toLowerCase();

        vols.forEach(v => {
            const prod = dbState.produtos[v.produtoId] || { nome: "???", codigo: "???" };
            buscaTexto += `${prod.nome} ${v.descricao} `.toLowerCase();
            htmlItens += `
                <div class="item-row" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding:5px 0;">
                    <div style="font-size:11px;"><b>${v.quantidade}x</b> ${v.descricao}</div>
                    ${userRole !== 'leitor' ? `
                        <div style="display:flex; gap:3px;">
                            <button onclick="window.abrirAcao('${v.id}', 'mover')" class="btn-mini" style="background:var(--info); color:white; border:none; padding:2px 5px; cursor:pointer;"><i class="fas fa-exchange-alt"></i></button>
                            <button onclick="window.abrirAcao('${v.id}', 'saida')" class="btn-mini" style="background:var(--danger); color:white; border:none; padding:2px 5px; cursor:pointer;"><i class="fas fa-sign-out-alt"></i></button>
                        </div>
                    ` : ''}
                </div>
            `;
        });

        card.dataset.busca = buscaTexto;
        card.innerHTML = `
            <div class="card-header" style="background:var(--primary); color:white; padding:5px 10px; display:flex; justify-content:space-between;">
                R${e.rua}-M${e.modulo}-N${e.nivel}
                ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarEndereco('${e.id}')" style="cursor:pointer;"></i>` : ''}
            </div>
            <div class="card-body" style="padding:10px;">${htmlItens || '<small color="#ccc">Vazio</small>'}</div>
        `;
        grid.appendChild(card);
    });
}

// FUNÇÃO PARA NOVO ENDEREÇO (Ajustada para o seu HTML)
window.abrirNovoEndereco = () => {
    if(userRole !== 'admin') return alert("Acesso negado");
    const modal = document.getElementById("modalMaster");
    const title = document.getElementById("modalTitle");
    const body = document.getElementById("modalBody");

    title.innerText = "Novo Endereço";
    body.innerHTML = `
        <label>RUA:</label><input type="text" id="addRua" style="width:100%; margin-bottom:10px;">
        <label>MÓDULO:</label><input type="number" id="addMod" style="width:100%; margin-bottom:10px;">
        <label>NÍVEL:</label><input type="number" id="addNiv" value="1" style="width:100%;">
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const rua = document.getElementById("addRua").value.trim().toUpperCase();
        const mod = document.getElementById("addMod").value.trim();
        const niv = document.getElementById("addNiv").value.trim();
        if(!rua || !mod) return alert("Preencha os campos!");

        await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv });
        window.fecharModal();
        loadAll();
    };
};

window.abrirAcao = (volId, tipo) => {
    if(userRole === 'leitor') return;
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    const body = document.getElementById("modalBody");
    
    body.innerHTML = `
        <div style="margin-bottom:10px;">Item: <b>${vol.descricao}</b></div>
        <label>QTD:</label><input type="number" id="qtdAcao" value="${vol.quantidade}" max="${vol.quantidade}" style="width:100%; margin-bottom:10px;">
    `;

    if(tipo !== 'saida') {
        let opts = dbState.enderecos.map(e => `<option value="${e.id}">R${e.rua}-M${e.modulo}-N${e.nivel}</option>`).join('');
        body.innerHTML += `<label>DESTINO:</label><select id="selDestino" style="width:100%;">${opts}</select>`;
    }

    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const qtd = parseInt(document.getElementById("qtdAcao").value);
        try {
            if(tipo === 'saida') {
                await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) });
                await addDoc(collection(db, "movimentacoes"), { tipo: "SAÍDA", produto: vol.descricao, quantidade: qtd, usuario: usernameDB, data: serverTimestamp() });
            } else {
                const destId = document.getElementById("selDestino").value;
                // Lógica de Aglutinação (Merge)
                const existente = dbState.volumes.find(v => v.enderecoId === destId && v.produtoId === vol.produtoId && v.codigo === vol.codigo);
                
                if(existente) {
                    await updateDoc(doc(db, "volumes", existente.id), { quantidade: increment(qtd) });
                    if(qtd === vol.quantidade) await deleteDoc(doc(db, "volumes", volId));
                    else await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) });
                } else {
                    if(qtd === vol.quantidade) await updateDoc(doc(db, "volumes", volId), { enderecoId: destId });
                    else {
                        await addDoc(collection(db, "volumes"), { ...vol, id: null, quantidade: qtd, enderecoId: destId });
                        await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) });
                    }
                }
                await addDoc(collection(db, "movimentacoes"), { tipo: "MOV", produto: vol.descricao, quantidade: qtd, usuario: usernameDB, data: serverTimestamp() });
            }
            window.fecharModal(); loadAll();
        } catch(err) { alert("Erro ao processar"); }
    };
};

window.deletarEndereco = async (id) => {
    if(userRole !== 'admin') return;
    if(confirm("Excluir endereço?")){
        const afetados = dbState.volumes.filter(v => v.enderecoId === id);
        for(let v of afetados) { await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" }); }
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.filtrarEstoque = () => { /* lógica de filtro se desejar */ };
window.limparFiltros = () => { location.reload(); };
