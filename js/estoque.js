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

    const selFiltro = document.getElementById("filtroForn");
    if(selFiltro) {
        selFiltro.innerHTML = '<option value="">Todos os Fornecedores</option>';
        Object.values(dbState.fornecedores).sort().forEach(nome => {
            selFiltro.innerHTML += `<option value="${nome}">${nome}</option>`;
        });
    }

    // Carregar filtros salvos
    document.getElementById("filtroCod").value = localStorage.getItem('f_est_cod') || "";
    document.getElementById("filtroDesc").value = localStorage.getItem('f_est_desc') || "";
    const fornSalvo = localStorage.getItem('f_est_forn') || "";
    if(selFiltro) selFiltro.value = fornSalvo;

    syncUI();
}

function syncUI() {
    const grid = document.getElementById("gridEnderecos");
    const pendentes = document.getElementById("listaPendentes");
    if(!grid || !pendentes) return;

    grid.innerHTML = "";
    pendentes.innerHTML = "";

    // 1. Renderizar Pendentes
    dbState.volumes.filter(v => !v.enderecoId || v.enderecoId === "").forEach(v => {
        const prod = dbState.produtos[v.produtoId] || { nome: "---", fornecedorId: "" };
        const fNome = dbState.fornecedores[prod.fornecedorId] || "---";
        const div = document.createElement("div");
        div.className = "item-pendente";
        div.innerHTML = `
            <div style="flex:1">
                <small>${fNome}</small><br>
                <b>${v.descricao}</b><br>
                <span class="badge-qtd">Qtd: ${v.quantidade}</span>
            </div>
            <button onclick="window.abrirMover('${v.id}')" class="btn" style="background:var(--success); color:white;">GUARDAR</button>
        `;
        pendentes.appendChild(div);
    });

    // 2. Renderizar Grid
    dbState.enderecos.forEach(e => {
        const vols = dbState.volumes.filter(v => v.enderecoId === e.id && v.quantidade > 0);
        const card = document.createElement("div");
        card.className = "card-endereco";
        const txtBusca = `${e.rua} ${e.modulo} ${vols.map(v => v.descricao + ' ' + (dbState.fornecedores[dbState.produtos[v.produtoId]?.fornecedorId] || '')).join(" ")}`.toLowerCase();
        card.dataset.busca = txtBusca;

        let itensHTML = vols.map(v => `
            <div class="vol-item">
                <span><b>${v.quantidade}x</b> ${v.descricao}</span>
                <div style="display:flex; gap:5px;">
                    <button onclick="window.abrirMover('${v.id}')" title="Mover" style="border:none; background:none; color:var(--primary); cursor:pointer;"><i class="fas fa-exchange-alt"></i></button>
                    <button onclick="window.abrirSaida('${v.id}')" title="Saída" style="border:none; background:none; color:var(--danger); cursor:pointer;"><i class="fas fa-sign-out-alt"></i></button>
                </div>
            </div>
        `).join("");

        card.innerHTML = `
            <div class="card-header">
                <span>RUA <b>${e.rua}</b> MOD <b>${e.modulo}</b> NIV <b>${e.nivel}</b></span>
                ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarLocal('${e.id}')" style="cursor:pointer; opacity:0.5"></i>` : ''}
            </div>
            <div class="card-body">${itensHTML || '<small style="color:#ccc">Vazio</small>'}</div>
        `;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

window.abrirMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Endereçar Volume";
    
    let opts = dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} - NIV ${e.nivel}</option>`).join('');
    
    document.getElementById("modalBody").innerHTML = `
        <p>Produto: <b>${vol.descricao}</b></p>
        <p style="font-size:12px">Qtd disponível: <b>${vol.quantidade}</b></p>
        <label>QUANTIDADE A GUARDAR:</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="width:100%; text-align:center;">
        <label style="display:block; margin-top:10px;">ENDEREÇO DESTINO:</label>
        <select id="selDestino" style="width:100%;">${opts}</select>
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const destinoId = document.getElementById("selDestino").value;
        const q = parseInt(document.getElementById("qtdMover").value);

        if(q <= 0 || q > vol.quantidade) return alert("Quantidade inválida!");

        if (q === vol.quantidade) {
            await updateDoc(doc(db, "volumes", volId), { enderecoId: destinoId, ultimaMovimentacao: serverTimestamp() });
        } else {
            // DESMEMBRAMENTO (Split)
            await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-q) });
            await addDoc(collection(db, "volumes"), {
                produtoId: vol.produtoId, descricao: vol.descricao, codigo: vol.codigo || "",
                quantidade: q, enderecoId: destinoId, ultimaMovimentacao: serverTimestamp()
            });
        }

        await addDoc(collection(db, "movimentacoes"), {
            tipo: "Endereçamento", produto: vol.descricao, quantidade: q, usuario: usernameDB, data: serverTimestamp()
        });
        window.fecharModal(); loadAll();
    };
};

window.abrirSaida = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Dar Saída";
    document.getElementById("modalBody").innerHTML = `
        <p>Produto: <b>${vol.descricao}</b></p>
        <label>QUANTIDADE DE SAÍDA:</label>
        <input type="number" id="qtdSaida" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="width:100%; text-align:center;">
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const q = parseInt(document.getElementById("qtdSaida").value);
        if(q > 0 && q <= vol.quantidade) {
            await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-q) });
            await addDoc(collection(db, "movimentacoes"), { 
                produto: vol.descricao, tipo: "Saída", quantidade: q, usuario: usernameDB, data: serverTimestamp() 
            });
            window.fecharModal(); loadAll();
        }
    };
};

window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    localStorage.setItem('f_est_cod', fCod);
    localStorage.setItem('f_est_forn', fForn);
    localStorage.setItem('f_est_desc', fDesc);

    let c = 0;
    document.querySelectorAll(".card-endereco").forEach(card => {
        const b = card.dataset.busca;
        const match = b.includes(fCod) && (fForn === "" || b.includes(fForn)) && b.includes(fDesc);
        card.style.display = match ? "block" : "none";
        if(match) c++;
    });
    document.getElementById("countDisplay").innerText = c;
};

window.criarEndereco = async () => {
    if(userRole !== 'admin') return;
    const r = document.getElementById("addRua").value.trim().toUpperCase();
    const m = document.getElementById("addMod").value.trim();
    const n = document.getElementById("addNiv").value.trim() || "1";
    if(!r || !m) return alert("Rua e Módulo obrigatórios!");

    // VERIFICAÇÃO DE DUPLICIDADE
    const existe = dbState.enderecos.find(e => e.rua === r && e.modulo === m && e.nivel === n);
    if(existe) return alert("Este endereço já está cadastrado!");

    await addDoc(collection(db, "enderecos"), { rua: r, modulo: m, nivel: n, data: serverTimestamp() });
    document.getElementById("addRua").value = "";
    document.getElementById("addMod").value = "";
    loadAll();
};

window.deletarLocal = async (id) => {
    if(userRole !== 'admin') return;
    if(confirm("Excluir endereço? Itens nele voltarão para Pendentes.")){
        const afetados = dbState.volumes.filter(v => v.enderecoId === id);
        for(let v of afetados) { await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" }); }
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};

window.limparFiltros = () => {
    localStorage.removeItem('f_est_cod');
    localStorage.removeItem('f_est_forn');
    localStorage.removeItem('f_est_desc');
    location.reload();
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
