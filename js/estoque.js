import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let usernameDB = "Usuário";
let userRole = "leitor";

onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || "Usuário";
            userRole = data.role || "leitor";
            
            // Regra de Administrador: Só ele vê o painel de cadastro de endereços
            const painel = document.getElementById("painelAdmin");
            if(painel) painel.style.display = (userRole === 'admin') ? 'flex' : 'none';
        }
        const display = document.getElementById("userDisplay");
        if(display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    const [fSnap, pSnap, eSnap, vSnap] = await Promise.all([
        getDocs(collection(db, "fornecedores")),
        getDocs(collection(db, "produtos")),
        getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo"))),
        getDocs(collection(db, "volumes"))
    ]);

    dbState.fornecedores = {};
    fSnap.forEach(d => dbState.fornecedores[d.id] = d.data().nome);
    dbState.produtos = {};
    pSnap.forEach(d => dbState.produtos[d.id] = d.data());
    dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Preencher filtro de fornecedores
    const selFiltro = document.getElementById("filtroForn");
    if(selFiltro) {
        selFiltro.innerHTML = '<option value="">Todos os Fornecedores</option>';
        Object.values(dbState.fornecedores).sort().forEach(nome => {
            selFiltro.innerHTML += `<option value="${nome}">${nome}</option>`;
        });
    }

    // Recuperar Filtros do LocalStorage
    document.getElementById("filtroCod").value = localStorage.getItem('est_f_cod') || "";
    document.getElementById("filtroDesc").value = localStorage.getItem('est_f_desc') || "";
    const fornSalvo = localStorage.getItem('est_f_forn') || "";
    setTimeout(() => { if(selFiltro) selFiltro.value = fornSalvo; syncUI(); }, 100);
}

function syncUI() {
    const grid = document.getElementById("gridEnderecos");
    const pendentes = document.getElementById("listaPendentes");
    if(!grid || !pendentes) return;

    grid.innerHTML = "";
    pendentes.innerHTML = "";

    // 1. Volumes em Aguardando Endereçamento (Sem enderecoId)
    dbState.volumes.filter(v => !v.enderecoId || v.enderecoId === "").forEach(v => {
        const p = dbState.produtos[v.produtoId] || { nome: "Produto Excluido" };
        const fNome = dbState.fornecedores[p.fornecedorId] || "---";
        
        const div = document.createElement("div");
        div.className = "item-pendente";
        div.innerHTML = `
            <div style="flex:1">
                <small>${fNome}</small><br>
                <b>${v.descricao}</b> <span style="font-size:10px">(${v.codigo || ''})</span><br>
                <span class="badge-qtd">Entrada: ${v.quantidade}</span>
            </div>
            <button onclick="window.abrirMover('${v.id}')" class="btn" style="background:var(--success); color:white;">GUARDAR</button>
        `;
        pendentes.appendChild(div);
    });

    // 2. Grid de Endereços
    dbState.enderecos.forEach(e => {
        const vols = dbState.volumes.filter(v => v.enderecoId === e.id && v.quantidade > 0);
        const card = document.createElement("div");
        card.className = "card-endereco";
        const buscaTexto = `${e.rua} ${e.modulo} ${vols.map(v => v.descricao + ' ' + (dbState.fornecedores[dbState.produtos[v.produtoId]?.fornecedorId] || '')).join(" ")}`.toLowerCase();
        card.dataset.busca = buscaTexto;

        let itensHTML = vols.map(v => `
            <div class="vol-item">
                <span style="font-size:12px"><b>${v.quantidade}x</b> ${v.descricao}</span>
                <div style="display:flex; gap:4px;">
                    <button onclick="window.abrirMover('${v.id}')" title="Mover" style="border:none; background:none; color:var(--primary); cursor:pointer;"><i class="fas fa-exchange-alt"></i></button>
                    <button onclick="window.abrirSaida('${v.id}')" title="Saída" style="border:none; background:none; color:var(--danger); cursor:pointer;"><i class="fas fa-sign-out-alt"></i></button>
                </div>
            </div>
        `).join("");

        card.innerHTML = `
            <div class="card-header">
                <span>RUA <b>${e.rua}</b> MOD <b>${e.modulo}</b> NIV <b>${e.nivel}</b></span>
                ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarLocal('${e.id}')" style="cursor:pointer; opacity:0.4"></i>` : ''}
            </div>
            <div class="card-body">${itensHTML || '<small style="color:#bbb">Vazio</small>'}</div>
        `;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

// --- LÓGICA DE GUARDAR / MOVER COM SPLIT (DESMEMBRAMENTO) ---
window.abrirMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Endereçar / Mover";
    
    let opts = dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} - NIV ${e.nivel}</option>`).join('');
    
    document.getElementById("modalBody").innerHTML = `
        <p style="margin:0">Volume: <b>${vol.descricao}</b></p>
        <p style="font-size:12px; color:var(--primary)">Disponível: ${vol.quantidade}</p>
        <label style="font-size:11px; font-weight:bold;">QUANTIDADE A MOVER:</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="width:100%; font-size:18px; text-align:center; margin-bottom:10px;">
        <label style="font-size:11px; font-weight:bold;">ENDEREÇO DESTINO:</label>
        <select id="selDestino" style="width:100%; padding:8px;">${opts}</select>
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const destinoId = document.getElementById("selDestino").value;
        const qtdMover = parseInt(document.getElementById("qtdMover").value);

        if(qtdMover <= 0 || qtdMover > vol.quantidade) return alert("Quantidade inválida!");

        try {
            if (qtdMover === vol.quantidade) {
                // Move o volume inteiro
                await updateDoc(doc(db, "volumes", volId), { enderecoId: destinoId, ultimaMovimentacao: serverTimestamp() });
            } else {
                // DESMEMBRAMENTO (Split)
                // 1. Diminui do volume atual (que fica onde está ou pendente)
                await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtdMover) });
                // 2. Cria um novo registro no endereço de destino
                await addDoc(collection(db, "volumes"), {
                    ...vol,
                    id: null, // Deixa o Firebase gerar novo ID
                    quantidade: qtdMover,
                    enderecoId: destinoId,
                    ultimaMovimentacao: serverTimestamp()
                });
            }

            await addDoc(collection(db, "movimentacoes"), {
                tipo: "Endereçamento", produto: vol.descricao, quantidade: qtdMover, 
                usuario: usernameDB, data: serverTimestamp(), detalhe: `Movido para ${destinoId}`
            });

            window.fecharModal();
            loadAll();
        } catch (e) { alert("Erro ao movimentar."); }
    };
};

// --- FILTRO COM PERSISTÊNCIA ---
window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    localStorage.setItem('est_f_cod', fCod);
    localStorage.setItem('est_f_forn', fForn);
    localStorage.setItem('est_f_desc', fDesc);

    let count = 0;
    document.querySelectorAll(".card-endereco").forEach(card => {
        const txt = card.dataset.busca;
        const match = txt.includes(fCod) && (fForn === "" || txt.includes(fForn)) && txt.includes(fDesc);
        card.style.display = match ? "block" : "none";
        if(match) count++;
    });
    document.getElementById("countDisplay").innerText = count;
};

window.limparFiltros = () => {
    localStorage.removeItem('est_f_cod');
    localStorage.removeItem('est_f_forn');
    localStorage.removeItem('est_f_desc');
    location.reload();
};

window.criarEndereco = async () => {
    if(userRole !== 'admin') return;
    const rua = document.getElementById("addRua").value.trim().toUpperCase();
    const mod = document.getElementById("addMod").value.trim();
    const niv = document.getElementById("addNiv").value.trim();
    if(!rua || !mod) return alert("Rua e Módulo são obrigatórios!");
    
    await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv, data: serverTimestamp() });
    document.getElementById("addRua").value = "";
    document.getElementById("addMod").value = "";
    loadAll();
};

window.deletarLocal = async (id) => {
    if(userRole !== 'admin') return;
    if(confirm("Excluir endereço? Os volumes nele voltarão para Pendentes.")){
        const afetados = dbState.volumes.filter(v => v.enderecoId === id);
        for(let v of afetados) { await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" }); }
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
