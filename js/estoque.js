import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let nomeUsuarioLogado = "---";

onAuthStateChanged(auth, async user => {
    if (user) {
        // BUSCA O NOME NO CAMINHO USERS/UID/USERNAME
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                nomeUsuarioLogado = userDoc.data().username || user.email;
            } else {
                nomeUsuarioLogado = user.email.split('@')[0].toUpperCase();
            }
            document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-circle"></i> ${nomeUsuarioLogado}`;
        } catch (e) { console.error("Erro user:", e); }
        
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    // 1. Fornecedores
    const fSnap = await getDocs(collection(db, "fornecedores"));
    const sel = document.getElementById("filtroForn");
    sel.innerHTML = '<option value="">Todos os Fornecedores</option>';
    fSnap.forEach(d => {
        dbState.fornecedores[d.id] = d.data().nome;
        sel.innerHTML += `<option value="${d.data().nome}">${d.data().nome}</option>`;
    });

    // 2. Produtos
    const pSnap = await getDocs(collection(db, "produtos"));
    pSnap.forEach(d => {
        const p = d.data();
        dbState.produtos[d.id] = { 
            nome: p.nome, 
            forn: dbState.fornecedores[p.fornecedorId] || "S/ FORN", 
            cod: (p.codigo || "").toLowerCase() 
        };
    });

    // 3. Restaurar Filtros
    document.getElementById("filtroCod").value = localStorage.getItem('f_est_cod') || "";
    document.getElementById("filtroDesc").value = localStorage.getItem('f_est_desc') || "";
    const savedForn = localStorage.getItem('f_est_forn') || "";
    setTimeout(() => { 
        document.getElementById("filtroForn").value = savedForn; 
        window.filtrarEstoque(); 
    }, 300);

    await syncUI();
}

async function syncUI() {
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.enderecos = eSnap.docs.map(d => ({id: d.id, ...d.data()}));
    dbState.volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));
    
    // AQUI AS FUNÇÕES SÃO CHAMADAS APÓS SEREM DEFINIDAS ABAIXO
    renderPendentes();
    renderEnderecos();
}

// DEFINIÇÃO DA FUNÇÃO QUE ESTAVA DANDO ERRO
function renderPendentes() {
    const lista = document.getElementById("listaPendentes");
    lista.innerHTML = "";
    dbState.volumes.forEach(v => {
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = dbState.produtos[v.produtoId] || { nome: "Produto", forn: "---" };
            lista.innerHTML += `
                <div style="background:white; padding:12px; border-radius:8px; margin-bottom:10px; border-left:5px solid var(--danger); box-shadow:0 2px 4px rgba(0,0,0,0.1);">
                    <div style="color:var(--danger); font-size:10px; font-weight:800; text-transform:uppercase;">${p.forn}</div>
                    <div style="font-size:12px; font-weight:bold; margin:3px 0;">${v.descricao}</div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                        <span style="font-size:11px;">Qtd: <b>${v.quantidade}</b></span>
                        <button onclick="window.abrirMover('${v.id}')" class="btn-action btn-success">GUARDAR</button>
                    </div>
                </div>`;
        }
    });
}

function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";
    
    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        const totalVols = vols.reduce((acc, curr) => acc + parseInt(curr.quantidade), 0);
        
        const buscaStr = vols.map(v => {
            const p = dbState.produtos[v.produtoId] || {};
            return `${p.nome} ${p.forn} ${v.descricao} ${p.cod}`;
        }).join(" ").toLowerCase();

        const card = document.createElement("div");
        card.className = "card-endereco";
        card.dataset.busca = buscaStr;
        card.innerHTML = `
            <div class="addr-summary" onclick="this.nextElementSibling.classList.toggle('active')">
                <div>
                    <strong style="color:var(--primary); font-size:14px;">R:${end.rua} M:${end.modulo}</strong> 
                    <span style="font-size:11px; margin-left:10px; color:#888;">NÍVEL ${end.nivel || '0'}</span>
                </div>
                <div style="display:flex; align-items:center; gap:12px;">
                    <span style="background:#e3f2fd; color:var(--primary); padding:4px 10px; border-radius:5px; font-size:11px; font-weight:bold;">
                        ${totalVols} UNID.
                    </span>
                    <i class="fas fa-chevron-down" style="color:#ccc;"></i>
                </div>
            </div>
            <div class="addr-details">
                ${vols.map(v => {
                    const p = dbState.produtos[v.produtoId] || {nome: 'N/A', forn: '---'};
                    return `
                    <div class="item-linha">
                        <div class="fornecedor-badge">${p.forn}</div>
                        <div style="font-size:12px; font-weight:bold;">${p.nome}</div>
                        <div style="font-size:12px; color:#444;">${v.quantidade}x ${v.descricao}</div>
                        <div style="display:flex; gap:8px; margin-top:8px;">
                            <button onclick="window.abrirMover('${v.id}')" style="flex:1; padding:5px; cursor:pointer;">MOVER</button>
                            <button onclick="window.darSaida('${v.id}')" style="flex:1; padding:5px; background:var(--danger); color:white; border:none; border-radius:4px; cursor:pointer;">SAÍDA</button>
                        </div>
                    </div>`;
                }).join('') || '<div style="text-align:center; padding:15px; color:#999; font-size:11px;">Local Vazio</div>'}
                <button onclick="window.deletarEndereco('${end.id}')" style="width:100%; background:none; border:none; color:var(--danger); font-size:10px; cursor:pointer; margin-top:10px; opacity:0.6;">
                    <i class="fas fa-trash"></i> EXCLUIR ESTE ENDEREÇO
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

// LOGICA DE FILTRO
window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    localStorage.setItem('f_est_cod', fCod);
    localStorage.setItem('f_est_forn', document.getElementById("filtroForn").value);
    localStorage.setItem('f_est_desc', fDesc);

    let count = 0;
    document.querySelectorAll(".card-endereco").forEach(card => {
        const b = card.dataset.busca;
        const match = b.includes(fCod) && (fForn === "" || b.includes(fForn)) && b.includes(fDesc);
        card.style.display = match ? "block" : "none";
        if(match) count++;
    });
    document.getElementById("countDisplay").innerText = count;
};

// CADASTRO COM TRAVA DE DUPLICIDADE
window.criarEndereco = async () => {
    const rua = document.getElementById("addRua").value.trim().toUpperCase();
    const mod = document.getElementById("addMod").value.trim();
    const niv = document.getElementById("addNiv").value.trim();

    if(!rua || !mod) return alert("Rua e Módulo são obrigatórios!");
    
    const jaExiste = dbState.enderecos.find(e => e.rua === rua && e.modulo === mod && e.nivel === niv);
    if(jaExiste) return alert("ERRO: Este endereço já está cadastrado no sistema!");

    await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv, data: serverTimestamp() });
    syncUI();
    document.getElementById("addRua").value = ""; 
    document.getElementById("addMod").value = "";
};

// EXCLUSÃO QUE DEVOLVE PROS PENDENTES
window.deletarEndereco = async (id) => {
    if (confirm("Volumes deste local voltarão para a lista de Pendentes. Confirmar?")) {
        const afetados = dbState.volumes.filter(v => v.enderecoId === id);
        for (let v of afetados) { await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" }); }
        await deleteDoc(doc(db, "enderecos", id));
        syncUI();
    }
};

// SAÍDA COM MODAL SOFISTICADO
window.darSaida = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const p = dbState.produtos[vol.produtoId] || {};
    const modal = document.getElementById("modalMaster");
    
    document.getElementById("modalTitle").innerHTML = `<i class="fas fa-box-open"></i> Confirmar Saída`;
    document.getElementById("modalBody").innerHTML = `
        <div style="background:#fff5f5; padding:15px; border-radius:10px; border-left:5px solid var(--danger);">
            <div class="fornecedor-badge">${p.forn}</div>
            <div style="font-weight:bold; font-size:15px;">${p.nome}</div>
            <div style="font-size:13px; color:#666;">${v.descricao}</div>
        </div>
        <div style="margin-top:20px;">
            <label style="font-size:12px; font-weight:bold;">QUANTIDADE (Saldo: ${vol.quantidade}):</label>
            <input type="number" id="qtdSaida" value="1" max="${vol.quantidade}" min="1" 
                   style="width:100%; font-size:22px; text-align:center; border:2px solid var(--danger); margin-top:10px; font-weight:bold; color:var(--danger);">
        </div>`;
    
    modal.style.display = "flex";
    document.getElementById("btnConfirmar").className = "btn-action btn-danger";
    document.getElementById("btnConfirmar").onclick = async () => {
        const q = parseInt(document.getElementById("qtdSaida").value);
        if(q > 0 && q <= vol.quantidade) {
            await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-q) });
            await addDoc(collection(db, "movimentacoes"), { 
                produto: p.nome, tipo: "Saída", quantidade: q, usuario: nomeUsuarioLogado, data: serverTimestamp() 
            });
            window.fecharModal(); syncUI();
        } else { alert("Quantidade inválida!"); }
    };
};

window.abrirMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Mover para Local";
    
    let options = dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('');
    
    document.getElementById("modalBody").innerHTML = `
        <p style="font-size:13px;">Selecionar destino para <b>${vol.descricao}</b>:</p>
        <select id="selectDestino" style="width:100%; padding:10px;">${options}</select>
        <input type="number" id="qtdMover" value="${vol.quantidade}" style="width:100%; margin-top:10px;">`;
    
    modal.style.display = "flex";
    document.getElementById("btnConfirmar").className = "btn-action btn-success";
    document.getElementById("btnConfirmar").onclick = async () => {
        const destId = document.getElementById("selectDestino").value;
        const q = parseInt(document.getElementById("qtdMover").value);
        if(destId && q > 0) {
            await updateDoc(doc(db, "volumes", volId), { enderecoId: destId, quantidade: q });
            window.fecharModal(); syncUI();
        }
    };
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
