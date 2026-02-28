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
            const btnEnd = document.getElementById("btnNovoEnd");
            if(btnEnd) btnEnd.style.display = (userRole === 'admin') ? 'block' : 'none';
        }
        const display = document.getElementById("userDisplay");
        if(display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB} (${userRole.toUpperCase()})`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    try {
        const fSnap = await getDocs(collection(db, "fornecedores"));
        const selFiltro = document.getElementById("filtroForn");
        if(selFiltro) selFiltro.innerHTML = '<option value="">Todos os Fornecedores</option>';
        
        fSnap.forEach(d => {
            dbState.fornecedores[d.id] = d.data().nome;
            if(selFiltro) selFiltro.innerHTML += `<option value="${d.data().nome}">${d.data().nome}</option>`;
        });

        const pSnap = await getDocs(collection(db, "produtos"));
        pSnap.forEach(d => {
            const p = d.data();
            dbState.produtos[d.id] = { nome: p.nome, forn: dbState.fornecedores[p.fornecedorId] || "---" };
        });

        // Persistência do filtro de fornecedor
        const salvo = localStorage.getItem('f_estoque_forn');
        if(salvo && selFiltro) selFiltro.value = salvo;

        await syncUI();
    } catch (e) { console.error("Erro no loadAll:", e); }
}

async function syncUI() {
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderPendentes();
    renderEnderecos();
}

function renderPendentes() {
    const area = document.getElementById("pendentesArea");
    if(!area) return;
    area.innerHTML = "";
    dbState.volumes.forEach(v => {
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = dbState.produtos[v.produtoId] || { nome: "---", forn: "---" };
            area.innerHTML += `
                <div class="card-pendente">
                    <div style="font-size:10px; color:var(--primary); font-weight:bold;">${p.forn}</div>
                    <div style="font-weight:bold; font-size:12px;">${p.nome}</div>
                    <div style="font-size:11px;">${v.descricao}</div>
                    <div style="margin-top:5px; display:flex; justify-content:space-between; align-items:center;">
                        <span>Qtd: <b>${v.quantidade}</b></span>
                        <button onclick="window.abrirModalMover('${v.id}')" class="btn" style="padding:2px 8px; font-size:10px; background:var(--success); color:white;">GUARDAR</button>
                    </div>
                </div>`;
        }
    });
}

function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    if(!grid) return;
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        
        // Texto para busca (Filtro)
        const buscaTexto = vols.map(v => {
            const p = dbState.produtos[v.produtoId] || {};
            return `${p.nome} ${p.forn} ${v.descricao}`;
        }).join(' ').toLowerCase();

        const card = document.createElement('div');
        card.className = "card-endereco";
        card.dataset.busca = buscaTexto;
        card.innerHTML = `
            <div class="card-end-header">
                <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="cursor:pointer; opacity:0.5"></i>` : ''}
            </div>
            <div class="card-end-body">
                ${vols.map(v => {
                    const p = dbState.produtos[v.produtoId] || { nome: "---", forn: "---" };
                    return `
                    <div class="vol-item">
                        <div style="font-size:10px; font-weight:bold; color:var(--primary)">${p.forn}</div>
                        <div style="font-weight:bold; font-size:11px;">${p.nome}</div>
                        <div style="font-size:11px;">${v.descricao}</div>
                        <div style="font-weight:800; margin:5px 0;">QTD: ${v.quantidade}</div>
                        <div style="display:flex; gap:5px;">
                            <button onclick="window.abrirModalMover('${v.id}')" class="btn" style="flex:1; padding:4px; font-size:10px; background:var(--primary); color:white;">MOVER</button>
                            <button onclick="window.darSaida('${v.id}', '${v.descricao}')" class="btn" style="flex:1; padding:4px; font-size:10px; background:var(--danger); color:white;">SAÍDA</button>
                        </div>
                    </div>`;
                }).join('') || '<div style="color:#ccc; font-size:12px; text-align:center; padding:10px;">Vazio</div>'}
            </div>`;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

// --- LÓGICA DE MOVER / GUARDAR (SOMA AUTOMÁTICA) ---
window.abrirModalMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    if(!vol) return;

    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Endereçar / Mover";
    document.getElementById("modalBody").innerHTML = `
        <p style="font-size:13px;">Volume: <b>${vol.descricao}</b></p>
        <label style="font-size:12px; font-weight:bold;">DESTINO:</label>
        <select id="selDestino" style="width:100%; padding:8px; margin-bottom:15px;">
            <option value="">-- Selecione o Endereço --</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
        </select>
        <label style="font-size:12px; font-weight:bold;">QUANTIDADE (Máx: ${vol.quantidade}):</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="width:100%; padding:8px;">
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmarModal").onclick = async () => {
        const destinoId = document.getElementById("selDestino").value;
        const qtd = parseInt(document.getElementById("qtdMover").value);

        if(!destinoId || isNaN(qtd) || qtd <= 0 || qtd > vol.quantidade) return alert("Dados inválidos");

        try {
            // BUSCA SE JÁ EXISTE ESTE VOLUME NO DESTINO (PARA SOMAR)
            const destinoExistente = dbState.volumes.find(v => 
                v.enderecoId === destinoId && 
                v.produtoId === vol.produtoId && 
                v.descricao === vol.descricao
            );

            if (destinoExistente) {
                // SOMA 25 + 25
                await updateDoc(doc(db, "volumes", destinoExistente.id), {
                    quantidade: increment(qtd),
                    ultimaMovimentacao: serverTimestamp()
                });
            } else {
                // CRIA NOVO SE NÃO EXISTIR LÁ
                await addDoc(collection(db, "volumes"), {
                    produtoId: vol.produtoId,
                    descricao: vol.descricao,
                    quantidade: qtd,
                    enderecoId: destinoId,
                    ultimaMovimentacao: serverTimestamp()
                });
            }

            // TIRA DA ORIGEM
            await updateDoc(doc(db, "volumes", vol.id), {
                quantidade: increment(-qtd),
                ultimaMovimentacao: serverTimestamp()
            });

            // HISTÓRICO
            await addDoc(collection(db, "movimentacoes"), {
                produto: vol.descricao, tipo: "Movimentação", quantidade: qtd,
                detalhe: `Para: ${destinoId}`, usuario: usernameDB, data: serverTimestamp()
            });

            window.fecharModal();
            syncUI();
        } catch (e) { console.error(e); }
    };
};

// --- FILTRO CORRIGIDO (SEM ERRO DE INDEXOF/NULL) ---
window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod")?.value.toLowerCase() || "";
    const fForn = document.getElementById("filtroForn")?.value.toLowerCase() || "";
    const fDesc = document.getElementById("filtroDesc")?.value.toLowerCase() || "";
    
    localStorage.setItem('f_estoque_forn', document.getElementById("filtroForn")?.value || "");

    let c = 0;
    document.querySelectorAll(".card-endereco").forEach(card => {
        // Garantimos que 'busca' nunca seja null
        const busca = (card.dataset.busca || "").toLowerCase();
        
        // Uso de includes (mais moderno que indexOf)
        const match = busca.includes(fCod) && 
                      busca.includes(fDesc) && 
                      (fForn === "" || busca.includes(fForn));

        card.style.display = match ? "flex" : "none";
        if(match) c++;
    });

    const countDisp = document.getElementById("countDisplay");
    if(countDisp) countDisp.innerText = c;
};

window.darSaida = async (volId, desc) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const q = prompt(`Baixa de: ${desc}\nQtd disponível: ${vol.quantidade}`, "1");
    if (q && parseInt(q) > 0 && parseInt(q) <= vol.quantidade) {
        await updateDoc(doc(db, "volumes", volId), { 
            quantidade: increment(-parseInt(q)),
            ultimaMovimentacao: serverTimestamp()
        });
        await addDoc(collection(db, "movimentacoes"), {
            produto: desc, tipo: "Saída", quantidade: parseInt(q), 
            detalhe: "Saída manual", usuario: usernameDB, data: serverTimestamp()
        });
        syncUI();
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    localStorage.removeItem('f_estoque_forn');
    window.filtrarEstoque();
};

window.deletarLocal = async (id) => {
    if (confirm("Excluir este endereço?")) {
        await deleteDoc(doc(db, "enderecos", id));
        syncUI();
    }
};

// Logout
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
