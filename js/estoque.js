import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let usernameDB = "Usuário";

// --- AUTENTICAÇÃO E CARREGAMENTO ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) usernameDB = userSnap.data().username || user.email.split('@')[0].toUpperCase();
        
        const display = document.getElementById("userDisplay");
        if(display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
        
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    // Carregar Fornecedores
    const fSnap = await getDocs(collection(db, "fornecedores"));
    const sel = document.getElementById("filtroForn");
    if(sel) {
        sel.innerHTML = '<option value="">Todos os Fornecedores</option>';
        fSnap.forEach(d => {
            dbState.fornecedores[d.id] = d.data().nome;
            sel.innerHTML += `<option value="${d.data().nome}">${d.data().nome}</option>`;
        });
    }

    // Carregar Produtos
    const pSnap = await getDocs(collection(db, "produtos"));
    pSnap.forEach(d => {
        const p = d.data();
        dbState.produtos[d.id] = { 
            nome: p.nome, 
            forn: dbState.fornecedores[p.fornecedorId] || "S/ FORN", 
            cod: (p.codigo || "").toLowerCase() 
        };
    });

    // Restaurar Filtros
    if(document.getElementById("filtroCod")) {
        document.getElementById("filtroCod").value = localStorage.getItem('f_est_cod') || "";
        document.getElementById("filtroDesc").value = localStorage.getItem('f_est_desc') || "";
        const savedForn = localStorage.getItem('f_est_forn') || "";
        setTimeout(() => { 
            if(document.getElementById("filtroForn")) {
                document.getElementById("filtroForn").value = savedForn; 
                window.filtrarEstoque();
            }
        }, 300);
    }

    await syncUI();
}

async function syncUI() {
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.enderecos = eSnap.docs.map(d => ({id: d.id, ...d.data()}));
    dbState.volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));
    
    renderPendentes();
    renderEnderecos();
}

// --- RENDERIZAÇÃO ---
function renderPendentes() {
    const lista = document.getElementById("listaPendentes");
    if(!lista) return;
    lista.innerHTML = "";
    dbState.volumes.forEach(v => {
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = dbState.produtos[v.produtoId] || { nome: "Produto", forn: "---" };
            lista.innerHTML += `
                <div style="background:white; padding:10px; border-radius:8px; margin-bottom:8px; border-left:5px solid var(--danger); box-shadow:0 2px 5px rgba(0,0,0,0.1);">
                    <div class="forn-tag">${p.forn}</div>
                    <div style="font-size:12px; font-weight:bold;">${v.descricao}</div>
                    <div style="display:flex; justify-content:space-between; margin-top:5px;">
                        <span style="font-size:11px;">Qtd: ${v.quantidade}</span>
                        <button onclick="window.abrirMover('${v.id}')" class="btn" style="background:var(--success); color:white; padding:4px 8px; font-size:10px;">GUARDAR</button>
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
        const totalU = vols.reduce((acc, curr) => acc + parseInt(curr.quantidade), 0);
        
        const busca = vols.map(v => {
            const p = dbState.produtos[v.produtoId] || {};
            return `${p.nome} ${p.forn} ${v.descricao} ${p.cod}`;
        }).join(" ").toLowerCase();

        const card = document.createElement("div");
        card.className = "card-endereco";
        card.dataset.busca = busca;
        card.innerHTML = `
            <div class="addr-summary" onclick="this.nextElementSibling.classList.toggle('active')">
                <div>
                    <b style="color:var(--primary)">R:${end.rua} M:${end.modulo}</b>
                    <span style="font-size:10px; color:#888; margin-left:10px;">NÍVEL ${end.nivel || '0'}</span>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="background:#e3f2fd; color:var(--primary); padding:3px 8px; border-radius:4px; font-size:11px; font-weight:bold;">${totalU} UNID.</span>
                    <i class="fas fa-chevron-down" style="color:#ccc; font-size:12px;"></i>
                </div>
            </div>
            <div class="addr-details">
                ${vols.map(v => {
                    const p = dbState.produtos[v.produtoId] || {nome:'N/A', forn:'---'};
                    return `
                    <div class="item-linha">
                        <div class="forn-tag">${p.forn}</div>
                        <div style="font-size:12px; font-weight:bold;">${p.nome}</div>
                        <div style="font-size:11px;">${v.quantidade}x ${v.descricao}</div>
                        <div style="display:flex; gap:5px; margin-top:8px;">
                            <button onclick="window.abrirMover('${v.id}')" style="flex:1; font-size:10px;">MOVER</button>
                            <button onclick="window.darSaida('${v.id}')" style="flex:1; font-size:10px; background:var(--danger); color:white; border:none; border-radius:3px;">SAÍDA</button>
                        </div>
                    </div>`;
                }).join('') || '<p style="text-align:center; font-size:10px; color:#999;">Vazio</p>'}
                <button onclick="window.deletarLocal('${end.id}')" style="width:100%; background:none; border:none; color:var(--danger); font-size:9px; margin-top:10px; cursor:pointer;">EXCLUIR LOCAL</button>
            </div>`;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

// --- LÓGICA DE MOVIMENTAÇÃO ---
window.abrirMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    if (!vol) return;

    const modal = document.getElementById("modalMaster");
    const title = document.getElementById("modalTitle");
    const body = document.getElementById("modalBody");
    const btnConfirmar = document.getElementById("btnConfirmar");

    title.innerText = "Mover Volume";
    let opts = dbState.enderecos.map(e => 
        `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} ${e.nivel ? '(Nív '+e.nivel+')' : ''}</option>`
    ).join('');

    body.innerHTML = `
        <p style="font-size:13px;">Destino para <b>${vol.descricao}</b>:</p>
        <select id="selD" style="width:100%; padding:8px; margin-bottom:15px;">
            <option value="">Selecione o local...</option>
            ${opts}
        </select>
        <label style="font-size:11px; font-weight:bold;">Quantidade (Máx: ${vol.quantidade}):</label>
        <input type="number" id="qtdM" value="${vol.quantidade}" max="${vol.quantidade}" min="1" style="width:100%; padding:8px;">`;

    modal.style.display = "flex";

    btnConfirmar.onclick = async () => {
        const destId = document.getElementById("selD").value;
        const qtd = parseInt(document.getElementById("qtdM").value);

        if (!destId || isNaN(qtd) || qtd <= 0 || qtd > vol.quantidade) {
            return alert("Verifique o destino e a quantidade!");
        }

        btnConfirmar.disabled = true;
        btnConfirmar.innerText = "PROCESSANDO...";
        
        await processarTransferencia(volId, destId, qtd);
        
        btnConfirmar.disabled = false;
        btnConfirmar.innerText = "CONFIRMAR";
    };
};

async function processarTransferencia(volIdOrigem, endIdDestino, qtd) {
    try {
        const volOrigem = dbState.volumes.find(v => v.id === volIdOrigem);
        const endDestino = dbState.enderecos.find(e => e.id === endIdDestino);
        
        const volNoDestino = dbState.volumes.find(v => 
            v.enderecoId === endIdDestino && 
            v.produtoId === volOrigem.produtoId && 
            v.descricao === volOrigem.descricao
        );

        if (qtd === volOrigem.quantidade) {
            if (volNoDestino) {
                await updateDoc(doc(db, "volumes", volNoDestino.id), { 
                    quantidade: increment(qtd),
                    ultimaMovimentacao: serverTimestamp() 
                });
                await deleteDoc(doc(db, "volumes", volIdOrigem));
            } else {
                await updateDoc(doc(db, "volumes", volIdOrigem), { 
                    enderecoId: endIdDestino,
                    ultimaMovimentacao: serverTimestamp()
                });
            }
        } else {
            await updateDoc(doc(db, "volumes", volIdOrigem), { 
                quantidade: increment(-qtd),
                ultimaMovimentacao: serverTimestamp()
            });

            if (volNoDestino) {
                await updateDoc(doc(db, "volumes", volNoDestino.id), { 
                    quantidade: increment(qtd),
                    ultimaMovimentacao: serverTimestamp() 
                });
            } else {
                await addDoc(collection(db, "volumes"), {
                    produtoId: volOrigem.produtoId,
                    descricao: volOrigem.descricao,
                    quantidade: qtd,
                    enderecoId: endIdDestino,
                    ultimaMovimentacao: serverTimestamp()
                });
            }
        }

        const tipoAcao = (!volOrigem.enderecoId) ? "Entrada/Guardar" : "Logística";
        await addDoc(collection(db, "movimentacoes"), {
            produto: volOrigem.descricao,
            tipo: tipoAcao,
            quantidade: qtd,
            usuario: usernameDB,
            data: serverTimestamp(),
            detalhe: `Para RUA ${endDestino.rua} MOD ${endDestino.modulo}`
        });

        window.fecharModal();
        await syncUI();

    } catch (e) {
        console.error("Erro na transferência:", e);
        alert("Erro ao realizar a movimentação.");
    }
}

// --- FILTROS E PESQUISA ---
window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroDesc").value = "";
    document.getElementById("filtroForn").value = "";

    localStorage.removeItem('f_est_cod');
    localStorage.removeItem('f_est_desc');
    localStorage.removeItem('f_est_forn');

    window.filtrarEstoque();
};

window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    localStorage.setItem('f_est_cod', fCod);
    localStorage.setItem('f_est_forn', document.getElementById("filtroForn").value);
    localStorage.setItem('f_est_desc', fDesc);

    let c = 0;
    document.querySelectorAll(".card-endereco").forEach(card => {
        const b = card.dataset.busca;
        const m = b.includes(fCod) && (fForn === "" || b.includes(fForn)) && b.includes(fDesc);
        card.style.display = m ? "block" : "none";
        if(m) c++;
    });
    const disp = document.getElementById("countDisplay");
    if(disp) disp.innerText = c;
};

// --- FUNÇÕES AUXILIARES ---
window.darSaida = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const p = dbState.produtos[vol.produtoId] || {};
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Registrar Saída";
    document.getElementById("modalBody").innerHTML = `
        <div style="background:#fff5f5; padding:15px; border-radius:8px; border-left:4px solid var(--danger);">
            <div class="forn-tag">${p.forn}</div>
            <b>${p.nome}</b><br><small>${vol.descricao}</small>
        </div>
        <input type="number" id="qtdS" value="1" max="${vol.quantidade}" min="1" style="width:100%; margin-top:15px; font-size:20px; text-align:center;">`;
    modal.style.display = "flex";
    
    document.getElementById("btnConfirmar").onclick = async () => {
        const q = parseInt(document.getElementById("qtdS").value);
        if(q > 0 && q <= vol.quantidade) {
            await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-q) });
            await addDoc(collection(db, "movimentacoes"), { 
                produto: vol.descricao, 
                tipo: "Saída", 
                quantidade: q, 
                usuario: usernameDB, 
                data: serverTimestamp() 
            });
            window.fecharModal(); 
            syncUI();
        }
    };
};

window.criarEndereco = async () => {
    const rua = document.getElementById("addRua").value.trim().toUpperCase();
    const mod = document.getElementById("addMod").value.trim();
    const niv = document.getElementById("addNiv").value.trim();
    if(!rua || !mod) return alert("Rua/Módulo obrigatórios!");
    
    const existe = dbState.enderecos.find(e => e.rua === rua && e.modulo === mod && e.nivel === niv);
    if(existe) return alert("Este endereço já existe!");

    await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv, data: serverTimestamp() });
    syncUI();
};

window.deletarLocal = async (id) => {
    if(confirm("Os volumes voltarão para Pendentes. Confirmar?")){
        const afetados = dbState.volumes.filter(v => v.enderecoId === id);
        for(let v of afetados) { await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" }); }
        await deleteDoc(doc(db, "enderecos", id));
        syncUI();
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
