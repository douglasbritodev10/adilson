import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };

onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById("labelUser").innerText = `Logado como: ${user.email.split('@')[0].toUpperCase()}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    try {
        // Carrega Fornecedores
        const fSnap = await getDocs(collection(db, "fornecedores"));
        const selFiltro = document.getElementById("filtroForn");
        selFiltro.innerHTML = '<option value="">Todos os Fornecedores</option>';
        fSnap.forEach(d => {
            const nome = d.data().nome;
            dbState.fornecedores[d.id] = nome;
            selFiltro.innerHTML += `<option value="${nome}">${nome}</option>`;
        });

        // Carrega Produtos
        const pSnap = await getDocs(collection(db, "produtos"));
        pSnap.forEach(d => {
            const p = d.data();
            dbState.produtos[d.id] = { 
                nome: p.nome, 
                cod: (p.codigo || "").toLowerCase(), 
                forn: dbState.fornecedores[p.fornecedorId] || "S/ FORNECEDOR" 
            };
        });

        // Recupera filtros do LocalStorage
        document.getElementById("filtroCod").value = localStorage.getItem('f_est_cod') || "";
        document.getElementById("filtroForn").value = localStorage.getItem('f_est_forn') || "";
        document.getElementById("filtroDesc").value = localStorage.getItem('f_est_desc') || "";

        await syncUI();
    } catch (e) { console.error("Erro no loadAll:", e); }
}

async function syncUI() {
    const qEnderecos = query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo"));
    const eSnap = await getDocs(qEnderecos);
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
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = dbState.produtos[v.produtoId] || { nome: "Excluído", forn: "---" };
            lista.innerHTML += `
                <div class="card-pendente">
                    <div class="fornecedor-tag">${p.forn}</div>
                    <div style="font-size: 11px; color: #666;">${p.nome}</div>
                    <div style="font-size: 13px; font-weight: bold; margin: 3px 0;">${v.descricao}</div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top:8px;">
                        <span>Qtd: <b>${v.quantidade}</b></span>
                        <button onclick="window.abrirModalMover('${v.id}')" class="btn-action btn-success">GUARDAR</button>
                    </div>
                </div>`;
        }
    });
}

function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const volsNesteLocal = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        
        // Atributo de busca consolidado
        const infoBusca = volsNesteLocal.map(v => {
            const p = dbState.produtos[v.produtoId] || { nome: "", forn: "", cod: "" };
            return `${p.nome} ${v.descricao} ${p.forn} ${p.cod}`;
        }).join(" ").toLowerCase();

        const card = document.createElement('div');
        card.className = "card-endereco";
        card.dataset.busca = infoBusca;
        card.innerHTML = `
            <div class="addr-header">
                <span>RUA ${end.rua} - MOD ${end.modulo} ${end.nivel ? ' - NV '+end.nivel : ''}</span>
                <i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="cursor:pointer; opacity:0.5;"></i>
            </div>
            <div style="padding: 10px; min-height: 40px;">
                ${volsNesteLocal.map(v => {
                    const p = dbState.produtos[v.produtoId] || { nome: "N/A", forn: "---" };
                    return `
                    <div style="border-bottom: 1px solid #eee; padding: 8px 0; margin-bottom: 5px;">
                        <div class="fornecedor-tag" style="color:#d32f2f;">${p.forn}</div>
                        <div style="font-size: 11px; font-weight:600;">${p.nome}</div>
                        <div style="font-size: 12px; margin: 3px 0;"><b>${v.quantidade}x</b> ${v.descricao}</div>
                        <div style="display: flex; gap: 5px; margin-top: 5px;">
                            <button onclick="window.abrirModalMover('${v.id}')" style="flex:1; font-size: 10px; padding: 4px;">MOVER</button>
                            <button onclick="window.darSaida('${v.id}')" style="flex:1; font-size: 10px; padding: 4px; color:white; background:#dc3545; border:none; border-radius:3px;">SAÍDA</button>
                        </div>
                    </div>`}).join('') || '<div style="color:#ccc; font-size:11px; text-align:center;">Vazio</div>'}
            </div>`;
        grid.appendChild(card);
    });
    window.filtrarEstoque(); // Aplica filtros após renderizar
}

window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    // Persiste os filtros
    localStorage.setItem('f_est_cod', fCod);
    localStorage.setItem('f_est_forn', fForn);
    localStorage.setItem('f_est_desc', fDesc);

    let visiveis = 0;
    document.querySelectorAll(".card-endereco").forEach(card => {
        const txt = card.dataset.busca;
        const matchesCod = txt.includes(fCod);
        const matchesForn = fForn === "" || txt.includes(fForn);
        const matchesDesc = txt.includes(fDesc);

        if (matchesCod && matchesForn && matchesDesc) {
            card.style.display = "";
            visiveis++;
        } else {
            card.style.display = "none";
        }
    });
    document.getElementById("countDisplay").innerText = visiveis;
};

window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    window.filtrarEstoque();
};

// MODAL DE SAÍDA SOFISTICADO (Preservado)
window.darSaida = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    if (!vol) return;
    const p = dbState.produtos[vol.produtoId] || { nome: "" };

    const modal = document.getElementById("modalMaster");
    const body = document.getElementById("modalBody");
    const btnConfirmar = document.getElementById("btnConfirmarModal");
    
    document.getElementById("modalTitle").innerHTML = `<i class="fas fa-box-open"></i> Registrar Saída`;
    body.innerHTML = `
        <div style="background: #fff5f5; padding: 12px; border-radius: 8px; border-left: 4px solid #dc3545; margin-bottom: 15px;">
            <div style="font-size: 10px; text-transform: uppercase; color: #dc3545; font-weight: bold;">${p.forn}</div>
            <div style="font-size: 14px; font-weight: bold;">${p.nome}</div>
            <div style="font-size: 13px; color: #555;">${vol.descricao}</div>
        </div>
        <label style="font-size:12px; font-weight:bold;">Quantidade para Baixa (Total: ${vol.quantidade}):</label>
        <input type="number" id="qtdSaida" value="1" max="${vol.quantidade}" min="1" 
               style="width: 100%; padding: 10px; border-radius: 6px; border: 2px solid #dc3545; font-size: 16px; font-weight: bold; box-sizing: border-box; margin-top:5px;">
    `;
    
    modal.style.display = "flex";
    btnConfirmar.innerText = "CONFIRMAR SAÍDA";
    btnConfirmar.className = "btn-action btn-danger";
    
    btnConfirmar.onclick = async () => {
        const q = parseInt(document.getElementById("qtdSaida").value);
        if (isNaN(q) || q <= 0 || q > vol.quantidade) return alert("Quantidade inválida!");
        try {
            await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-q) });
            await addDoc(collection(db, "movimentacoes"), { 
                produto: `${p.nome} - ${vol.descricao}`, 
                tipo: "Saída", quantidade: q, usuario: auth.currentUser.email, data: serverTimestamp() 
            });
            fecharModal(); syncUI();
        } catch (e) { alert("Erro na saída."); }
    };
};

window.abrirModalMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    const body = document.getElementById("modalBody");
    const btnConfirmar = document.getElementById("btnConfirmarModal");
    
    document.getElementById("modalTitle").innerText = "Mover para Endereço";
    let options = dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('');
    
    body.innerHTML = `
        <p style="font-size:13px;">Mover <b>${vol.descricao}</b> para:</p>
        <select id="selectDestino" style="width: 100%; padding: 10px; margin-bottom:15px;">${options}</select>
        <label style="font-size:12px;">Quantidade:</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" style="width: 100%; padding: 10px;">`;
    
    modal.style.display = "flex";
    btnConfirmar.className = "btn-action btn-success";
    btnConfirmar.onclick = async () => {
        const destId = document.getElementById("selectDestino").value;
        const qtd = parseInt(document.getElementById("qtdMover").value);
        if (destId && qtd > 0) processarTransferencia(volId, destId, qtd);
    };
};

async function processarTransferencia(volIdOrigem, endIdDestino, qtd) {
    try {
        const volOrigem = dbState.volumes.find(v => v.id === volIdOrigem);
        const p = dbState.produtos[volOrigem.produtoId];
        
        // Lógica de atualização simplificada para o exemplo
        await updateDoc(doc(db, "volumes", volIdOrigem), { quantidade: increment(-qtd) });
        await addDoc(collection(db, "volumes"), { 
            produtoId: volOrigem.produtoId, descricao: volOrigem.descricao, 
            quantidade: qtd, enderecoId: endIdDestino, ultimaMovimentacao: serverTimestamp() 
        });

        fecharModal(); syncUI();
    } catch (e) { alert("Erro ao mover."); }
}

window.exportarCSV = () => {
    let csv = "Fornecedor;Produto;Volume;Endereco;Quantidade\n";
    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        vols.forEach(v => {
            const p = dbState.produtos[v.produtoId] || { nome: "", forn: "" };
            csv += `${p.forn};${p.nome};${v.descricao};R${end.rua}-M${end.modulo};${v.quantidade}\n`;
        });
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "estoque_simonetti.csv");
    link.click();
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
