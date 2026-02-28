import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };

onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById("labelUser").innerText = `Olá, ${user.email.split('@')[0].toUpperCase()}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    const fSnap = await getDocs(collection(db, "fornecedores"));
    fSnap.forEach(d => dbState.fornecedores[d.id] = d.data().nome);

    const pSnap = await getDocs(collection(db, "produtos"));
    pSnap.forEach(d => {
        const p = d.data();
        dbState.produtos[d.id] = { nome: p.nome, forn: dbState.fornecedores[p.fornecedorId] || "---" };
    });
    syncUI();
}

async function syncUI() {
    let eSnap;
    try {
        eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    } catch(e) { eSnap = await getDocs(collection(db, "enderecos")); }
    
    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.enderecos = eSnap.docs.map(d => ({id: d.id, ...d.data()}));
    dbState.volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

    renderPendentes();
    renderEnderecos();
}

function renderPendentes() {
    const lista = document.getElementById("listaPendentes");
    lista.innerHTML = "";
    
    dbState.volumes.forEach(v => {
        // MOSTRA TUDO QUE TIVER QTD > 0 E SEM ENDEREÇO (Independente do nome do volume)
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = dbState.produtos[v.produtoId] || { nome: "---", forn: "---" };
            lista.innerHTML += `
                <div style="background: white; border: 1px solid #ddd; border-left: 5px solid var(--danger); padding: 12px; margin-bottom: 10px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="font-size: 10px; color: var(--primary); font-weight: bold; text-transform: uppercase;">${p.forn}</div>
                    <div style="font-size: 13px; font-weight: bold; margin: 5px 0;">${p.nome}</div>
                    <div style="font-size: 12px; color: #555; margin-bottom: 8px;">Volume: ${v.descricao}</div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Qtd: <b>${v.quantidade}</b></span>
                        <button onclick="window.abrirModalMover('${v.id}')" style="background: var(--success); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">GUARDAR</button>
                    </div>
                </div>`;
        }
    });
}

function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const volsAqui = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        grid.innerHTML += `
            <div style="background: white; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; box-shadow: var(--shadow);">
                <div style="background: var(--secondary); color: white; padding: 10px; font-weight: bold; font-size: 12px; display: flex; justify-content: space-between; align-items: center;">
                    <span>RUA ${end.rua} - MOD ${end.modulo} ${end.nivel ? '- NV '+end.nivel : ''}</span>
                    <i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="cursor:pointer; opacity: 0.5;"></i>
                </div>
                <div style="padding: 10px; min-height: 50px;">
                    ${volsAqui.map(v => `
                        <div style="border-bottom: 1px solid #eee; padding: 8px 0;">
                            <div style="font-size: 12px; font-weight: bold;">${v.quantidade}x ${v.descricao}</div>
                            <div style="display: flex; gap: 5px; margin-top: 5px;">
                                <button onclick="window.abrirModalMover('${v.id}')" style="flex:1; font-size: 9px; padding: 4px; cursor:pointer; background:#f8f9fa; border:1px solid #ccc;">MOVER</button>
                                <button onclick="window.darSaida('${v.id}', '${v.descricao}')" style="flex:1; font-size: 9px; padding: 4px; background:var(--danger); color:white; border:none; border-radius:3px; cursor:pointer;">SAÍDA</button>
                            </div>
                        </div>
                    `).join('') || '<div style="color:#ccc; font-size: 11px; text-align:center; padding: 10px;">Lugar Vazio</div>'}
                </div>
            </div>`;
    });
}

window.abrirModalMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    const body = document.getElementById("modalBody");

    let options = dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} ${e.nivel ? '(NV '+e.nivel+')' : ''}</option>`).join('');

    body.innerHTML = `
        <p style="font-size:13px; margin-bottom:10px;">Item: <b>${vol.descricao}</b></p>
        <label style="font-size:11px; font-weight:bold;">DESTINO:</label>
        <select id="selectDestino" style="width: 100%; padding: 10px; border-radius: 4px; border: 1px solid #ccc; margin-bottom:15px; margin-top:5px;">
            <option value="">Escolha a prateleira...</option>${options}
        </select>
        <label style="font-size:11px; font-weight:bold;">QUANTIDADE:</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" max="${vol.quantidade}" min="1" style="width: 93%; padding: 10px; border-radius: 4px; border: 1px solid #ccc; margin-top:5px;">`;

    modal.style.display = "flex";
    document.getElementById("btnConfirmar").onclick = () => {
        const destId = document.getElementById("selectDestino").value;
        const qtd = parseInt(document.getElementById("qtdMover").value);
        if (!destId || qtd <= 0 || qtd > vol.quantidade) return alert("Erro nos dados!");
        processarTransferencia(volId, destId, qtd);
    };
};

async function processarTransferencia(volIdOrigem, endIdDestino, qtd) {
    const volOrigem = dbState.volumes.find(v => v.id === volIdOrigem);
    const volNoDestino = dbState.volumes.find(v => v.enderecoId === endIdDestino && v.produtoId === volOrigem.produtoId && v.descricao === volOrigem.descricao);

    if (qtd === volOrigem.quantidade) {
        if (volNoDestino) {
            await updateDoc(doc(db, "volumes", volNoDestino.id), { quantidade: increment(qtd) });
            await deleteDoc(doc(db, "volumes", volIdOrigem));
        } else { await updateDoc(doc(db, "volumes", volIdOrigem), { enderecoId: endIdDestino }); }
    } else {
        await updateDoc(doc(db, "volumes", volIdOrigem), { quantidade: increment(-qtd) });
        if (volNoDestino) {
            await updateDoc(doc(db, "volumes", volNoDestino.id), { quantidade: increment(qtd) });
        } else {
            await addDoc(collection(db, "volumes"), {
                produtoId: volOrigem.produtoId, descricao: volOrigem.descricao, 
                quantidade: qtd, enderecoId: endIdDestino, ultimaMovimentacao: serverTimestamp() 
            });
        }
    }
    fecharModal();
    syncUI();
}

document.getElementById("btnCriarEndereco").onclick = async () => {
    const r = document.getElementById("addRua").value.toUpperCase();
    const m = document.getElementById("addModulo").value;
    const n = document.getElementById("addNivel").value;
    if(!r || !m) return alert("Preencha Rua e Módulo!");
    await addDoc(collection(db, "enderecos"), { rua: r, modulo: m, nivel: n, data: serverTimestamp() });
    syncUI();
};

window.deletarLocal = async (id) => {
    if(confirm("Os itens deste local ficarão sem endereço. Confirmar?")){
        const afetados = dbState.volumes.filter(v => v.enderecoId === id);
        for(let v of afetados) { await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" }); }
        await deleteDoc(doc(db, "enderecos", id));
        syncUI();
    }
};

window.darSaida = async (volId, desc) => {
    const q = prompt(`Baixa de estoque em ${desc}:`, "1");
    if(q && parseInt(q) > 0) {
        await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-parseInt(q)) });
        syncUI();
    }
};

window.fecharModal = () => { document.getElementById("modalMaster").style.display = "none"; };
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
