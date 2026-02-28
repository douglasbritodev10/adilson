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
            // Só admin vê botão de novo endereço
            if(userRole === 'admin') document.getElementById("btnNovoEnd").style.display = "block";
        }
        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
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

    const selF = document.getElementById("filtroForn");
    if(selF) {
        selF.innerHTML = '<option value="">Todos os Fornecedores</option>';
        Object.values(dbState.fornecedores).sort().forEach(n => selF.innerHTML += `<option value="${n}">${n}</option>`);
    }
    syncUI();
}

function syncUI() {
    const grid = document.getElementById("gridEnderecos");
    const pendentes = document.getElementById("listaPendentes");
    
    grid.innerHTML = "";
    pendentes.innerHTML = "";

    // 1. FILTRAR PENDENTES (Aguardando Armazenar): Somente Qtd > 0 e Sem Endereço
    const listaFalta = dbState.volumes.filter(v => (!v.enderecoId || v.enderecoId === "") && v.quantidade > 0);
    document.getElementById("countPendentes").innerText = listaFalta.length;

    listaFalta.forEach(v => {
        const p = dbState.produtos[v.produtoId] || { nome: "Desconhecido", fornecedorId: "" };
        const f = dbState.fornecedores[p.fornecedorId] || "---";
        
        const div = document.createElement("div");
        div.className = "item-pendente";
        div.innerHTML = `
            <div style="margin-bottom:8px;">
                <small style="color:var(--primary); font-weight:bold;">${f}</small><br>
                <b style="font-size:14px;">${v.descricao}</b>
                <span class="badge-info">SKU/Cod: ${v.codigo || 'S/N'}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="background:var(--warning); padding:2px 8px; border-radius:4px; font-weight:bold;">${v.quantidade} un</span>
                <button onclick="window.abrirGuardar('${v.id}')" class="btn btn-primary" style="padding:4px 10px; font-size:12px;">GUARDAR</button>
            </div>
        `;
        pendentes.appendChild(div);
    });

    // 2. GRID DE ENDEREÇOS
    dbState.enderecos.forEach(e => {
        const volsNesteEnd = dbState.volumes.filter(v => v.enderecoId === e.id && v.quantidade > 0);
        const card = document.createElement("div");
        card.className = "card-endereco";
        
        // Texto invisível para busca rápida
        const buscaData = `${e.rua} ${e.modulo} ${e.nivel} ${volsNesteEnd.map(v => v.descricao + ' ' + (v.codigo||'')).join(' ')}`.toLowerCase();
        card.dataset.busca = buscaData;
        card.dataset.forn = volsNesteEnd.map(v => dbState.fornecedores[dbState.produtos[v.produtoId]?.fornecedorId] || '').join('|').toLowerCase();

        let itensHTML = volsNesteEnd.map(v => `
            <div style="border-bottom:1px solid #eee; padding:4px 0;">
                <b>${v.quantidade}x</b> ${v.descricao}
            </div>
        `).join("");

        card.innerHTML = `
            <div class="card-header">RUA ${e.rua} - MOD ${e.modulo} - NIV ${e.nivel}</div>
            <div class="card-body">${itensHTML || '<small style="color:#ccc">Vazio</small>'}</div>
        `;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

// --- LÓGICA DE DESMEMBRAMENTO (SPLIT) ---
window.abrirGuardar = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Endereçar Volume";
    
    let opts = dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} - NIV ${e.nivel}</option>`).join('');
    
    document.getElementById("modalBody").innerHTML = `
        <p>Guardando: <b>${vol.descricao}</b></p>
        <p>Total disponível: <b>${vol.quantidade}</b></p>
        <label>QTD A SER ARMAZENADA NESTE ENDEREÇO:</label>
        <input type="number" id="qtdAcao" value="${vol.quantidade}" min="1" max="${vol.quantidade}">
        <label style="display:block; margin-top:15px;">SELECIONE O DESTINO:</label>
        <select id="selDestino">${opts}</select>
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const destinoId = document.getElementById("selDestino").value;
        const qtdInformada = parseInt(document.getElementById("qtdAcao").value);

        if(qtdInformada <= 0 || qtdInformada > vol.quantidade) return alert("Quantidade inválida!");

        try {
            if (qtdInformada === vol.quantidade) {
                // Caso guarde TUDO: Só atualiza o endereço
                await updateDoc(doc(db, "volumes", volId), { 
                    enderecoId: destinoId, 
                    ultimaMovimentacao: serverTimestamp() 
                });
            } else {
                // DESMEMBRAMENTO: Diminui do original e cria um novo já endereçado
                await updateDoc(doc(db, "volumes", volId), { 
                    quantidade: increment(-qtdInformada) 
                });
                await addDoc(collection(db, "volumes"), {
                    produtoId: vol.produtoId,
                    descricao: vol.descricao,
                    codigo: vol.codigo || "",
                    quantidade: qtdInformada,
                    enderecoId: destinoId,
                    ultimaMovimentacao: serverTimestamp()
                });
            }
            
            // Log de histórico
            await addDoc(collection(db, "movimentacoes"), {
                tipo: "Entrada/Endereçamento", produto: vol.descricao, quantidade: qtdInformada, usuario: usernameDB, data: serverTimestamp()
            });

            window.fecharModal();
            loadAll();
        } catch (e) { alert("Erro ao salvar."); }
    };
};

// --- CADASTRO DE ENDEREÇO ---
window.abrirNovoEndereco = () => {
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Cadastrar Novo Endereço";
    document.getElementById("modalBody").innerHTML = `
        <label>RUA (Ex: A, B, 01...)</label>
        <input type="text" id="newRua" placeholder="Rua" style="margin-bottom:10px;">
        <label>MÓDULO (Ex: 10, 20...)</label>
        <input type="number" id="newMod" placeholder="Módulo" style="margin-bottom:10px;">
        <label>NÍVEL (Ex: 1, 2, 3...)</label>
        <input type="number" id="newNiv" placeholder="Nível">
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const rua = document.getElementById("newRua").value.trim().toUpperCase();
        const mod = document.getElementById("newMod").value;
        const niv = document.getElementById("newNiv").value;

        if(!rua || !mod) return alert("Rua e Módulo são obrigatórios!");

        // Verifica duplicidade local
        if(dbState.enderecos.find(e => e.rua === rua && e.modulo === mod && e.nivel === niv)) {
            return alert("Este endereço já existe!");
        }

        await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv, data: serverTimestamp() });
        window.fecharModal();
        loadAll();
    };
};

window.filtrarEstoque = () => {
    const sku = document.getElementById("filtroSKU").value.toLowerCase();
    const forn = document.getElementById("filtroForn").value.toLowerCase();
    const desc = document.getElementById("filtroDesc").value.toLowerCase();
    let count = 0;

    document.querySelectorAll(".card-endereco").forEach(card => {
        const texto = card.dataset.busca;
        const fornecedores = card.dataset.forn;
        
        const matches = texto.includes(sku) && 
                        texto.includes(desc) && 
                        (forn === "" || fornecedores.includes(forn));

        card.style.display = matches ? "block" : "none";
        if(matches) count++;
    });
    document.getElementById("countDisplay").innerText = count;
};

window.limparFiltros = () => {
    document.getElementById("filtroSKU").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    window.filtrarEstoque();
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
