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
    try {
        const fSnap = await getDocs(collection(db, "fornecedores"));
        const selFiltro = document.getElementById("filtroForn");
        selFiltro.innerHTML = '<option value="">Todos os Fornecedores</option>';

        fSnap.forEach(d => {
            const nome = d.data().nome;
            dbState.fornecedores[d.id] = nome;
            selFiltro.innerHTML += `<option value="${nome}">${nome}</option>`;
        });

        const pSnap = await getDocs(collection(db, "produtos"));
        pSnap.forEach(d => {
            const p = d.data();
            dbState.produtos[d.id] = { 
                nome: p.nome, 
                cod: (p.codigo || "").toLowerCase(), 
                forn: dbState.fornecedores[p.fornecedorId] || "---" 
            };
        });

        // RECUPERA FILTROS SALVOS
        document.getElementById("filtroCod").value = localStorage.getItem('f_est_cod') || "";
        document.getElementById("filtroForn").value = localStorage.getItem('f_est_forn') || "";
        document.getElementById("filtroDesc").value = localStorage.getItem('f_est_desc') || "";

        await syncUI();
    } catch (e) { console.error("Erro no loadAll:", e); }
}

async function syncUI() {
    try {
        let eSnap;
        try {
            const qEnderecos = query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo"));
            eSnap = await getDocs(qEnderecos);
        } catch (indexError) {
            eSnap = await getDocs(collection(db, "enderecos"));
        }

        const vSnap = await getDocs(collection(db, "volumes"));
        dbState.enderecos = eSnap.docs.map(d => ({id: d.id, ...d.data()}));
        dbState.volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));

        renderPendentes();
        renderEnderecos();
    } catch (e) { console.error("Erro no syncUI:", e); }
}

function renderPendentes() {
    const lista = document.getElementById("listaPendentes");
    lista.innerHTML = "";
    dbState.volumes.forEach(v => {
        // Lógica mantida: Se não tem endereço, aparece aqui (mesmo que existam outros iguais endereçados)
        if (v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")) {
            const p = dbState.produtos[v.produtoId] || { nome: "Produto Excluído", forn: "---" };
            lista.innerHTML += `
                <div class="card-pendente">
                    <div style="font-size: 10px; color: #004a99; font-weight: bold; text-transform: uppercase;">${p.forn}</div>
                    <div style="font-size: 11px; color: #666;">${p.nome}</div> <div style="font-size: 13px; font-weight: bold; margin: 3px 0;">${v.descricao}</div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Qtd: <b>${v.quantidade}</b></span>
                        <button onclick="window.abrirModalMover('${v.id}')" style="background: #28a745; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 11px;">GUARDAR</button>
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
        
        const infoBusca = volsNesteLocal.map(v => {
            const p = dbState.produtos[v.produtoId] || { nome: "", forn: "", cod: "" };
            return `${p.nome} ${v.descricao} ${p.forn} ${p.cod}`;
        }).join(" ").toLowerCase();

        const card = document.createElement('div');
        card.className = "card-endereco";
        card.dataset.busca = infoBusca;
        card.innerHTML = `
            <div style="background: #002d5f; color: white; padding: 10px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
                <span>RUA ${end.rua} - MOD ${end.modulo} ${end.nivel ? '- NV '+end.nivel : ''}</span>
                <i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="cursor:pointer; font-size: 12px; opacity: 0.7;"></i>
            </div>
            <div style="padding: 10px; min-height: 50px;">
                ${volsNesteLocal.map(v => {
                    const p = dbState.produtos[v.produtoId] || { nome: "" };
                    return `
                    <div style="background: #fdfdfd; border-bottom: 1px solid #eee; padding: 8px 0; margin-bottom: 5px;">
                        <div style="font-size: 10px; color: #666;">${p.nome}</div>
                        <div style="font-size: 12px;"><b>${v.quantidade}x</b> ${v.descricao}</div>
                        <div style="display: flex; gap: 5px; margin-top: 5px;">
                            <button onclick="window.abrirModalMover('${v.id}')" style="flex:1; font-size: 10px; padding: 3px; cursor:pointer;">MOVER</button>
                            <button onclick="window.darSaida('${v.id}')" style="flex:1; font-size: 10px; padding: 3px; color: white; background: #dc3545; border:none; border-radius:3px;">SAÍDA</button>
                        </div>
                    </div>`}).join('') || '<div style="color: #ccc; font-size: 11px; text-align: center; padding: 10px;">Vazio</div>'}
            </div>`;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    // SALVA NO STORAGE
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
    document.getElementById("countFiltro").value = visiveis;
};

window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    window.filtrarEstoque();
};

// --- MODAIS ---
window.abrirModalMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    if (!vol) return;
    const modal = document.getElementById("modalMaster");
    const body = document.getElementById("modalBody");
    const btnConfirmar = document.getElementById("btnConfirmarModal");
    
    document.getElementById("modalTitle").innerText = "Mover Volume";
    let options = dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} ${e.nivel ? '(Nív '+e.nivel+')' : ''}</option>`).join('');
    
    body.innerHTML = `
        <p style="font-size:13px;">Mover <b>${vol.descricao}</b> para:</p>
        <select id="selectDestino" style="width: 100%; padding: 10px; border-radius: 4px; border: 1px solid #ccc; margin-bottom:15px;">
            <option value="">Selecione o local...</option>${options}
        </select>
        <label style="font-size:12px; font-weight:bold;">Quantidade (Máx: ${vol.quantidade}):</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" max="${vol.quantidade}" min="1" style="width: 95%; padding: 10px; border-radius: 4px; border: 1px solid #ccc;">`;
    
    modal.style.display = "flex";
    btnConfirmar.className = "btn-action btn-success";
    btnConfirmar.onclick = async () => {
        const destId = document.getElementById("selectDestino").value;
        const qtd = parseInt(document.getElementById("qtdMover").value);
        if (!destId || isNaN(qtd) || qtd <= 0 || qtd > vol.quantidade) return alert("Verifique os dados!");
        await processarTransferencia(volId, destId, qtd);
    };
};

// NOVO MODAL DE SAÍDA SOFISTICADO
window.darSaida = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    if (!vol) return;
    const p = dbState.produtos[vol.produtoId] || { nome: "" };

    const modal = document.getElementById("modalMaster");
    const body = document.getElementById("modalBody");
    const btnConfirmar = document.getElementById("btnConfirmarModal");
    
    document.getElementById("modalTitle").innerHTML = `<i class="fas fa-box-open"></i> Registrar Saída`;
    
    body.innerHTML = `
        <div style="background: #fff5f5; padding: 10px; border-radius: 8px; border-left: 4px solid #dc3545; margin-bottom: 15px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #dc3545; font-weight: bold;">Produto</div>
            <div style="font-size: 14px; font-weight: bold;">${p.nome}</div>
            <div style="font-size: 13px; color: #555;">${vol.descricao}</div>
        </div>
        <label style="font-size:12px; font-weight:bold;">Quantidade para Baixa (Disponível: ${vol.quantidade}):</label>
        <input type="number" id="qtdSaida" value="1" max="${vol.quantidade}" min="1" 
               style="width: 95%; padding: 12px; border-radius: 6px; border: 2px solid #dc3545; font-size: 16px; font-weight: bold; margin-top: 5px;">
        <p style="font-size: 11px; color: #888; margin-top: 10px;">* Esta ação registrará a saída no histórico de movimentações.</p>
    `;
    
    modal.style.display = "flex";
    btnConfirmar.innerText = "CONFIRMAR SAÍDA";
    btnConfirmar.className = "btn-action btn-danger"; // Estilo vermelho para saída
    
    btnConfirmar.onclick = async () => {
        const q = parseInt(document.getElementById("qtdSaida").value);
        if (isNaN(q) || q <= 0 || q > vol.quantidade) return alert("Quantidade inválida!");
        
        try {
            await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-q) });
            await addDoc(collection(db, "movimentacoes"), { 
                produto: `${p.nome} - ${vol.descricao}`, 
                tipo: "Saída", 
                quantidade: q, 
                usuario: auth.currentUser.email, 
                data: serverTimestamp() 
            });
            window.fecharModal();
            syncUI();
        } catch (e) {
            alert("Erro ao processar saída.");
        }
    };
};

async function processarTransferencia(volIdOrigem, endIdDestino, qtd) {
    try {
        const volOrigem = dbState.volumes.find(v => v.id === volIdOrigem);
        const endDestino = dbState.enderecos.find(e => e.id === endIdDestino);
        const volNoDestino = dbState.volumes.find(v => v.enderecoId === endIdDestino && v.produtoId === volOrigem.produtoId && v.descricao === volOrigem.descricao);
        
        if (qtd === volOrigem.quantidade) {
            if (volNoDestino) {
                await updateDoc(doc(db, "volumes", volNoDestino.id), { quantidade: increment(qtd), ultimaMovimentacao: serverTimestamp() });
                await deleteDoc(doc(db, "volumes", volIdOrigem));
            } else {
                await updateDoc(doc(db, "volumes", volIdOrigem), { enderecoId: endIdDestino, ultimaMovimentacao: serverTimestamp() });
            }
        } else {
            await updateDoc(doc(db, "volumes", volIdOrigem), { quantidade: increment(-qtd), ultimaMovimentacao: serverTimestamp() });
            if (volNoDestino) {
                await updateDoc(doc(db, "volumes", volNoDestino.id), { quantidade: increment(qtd), ultimaMovimentacao: serverTimestamp() });
            } else {
                await addDoc(collection(db, "volumes"), { produtoId: volOrigem.produtoId, descricao: volOrigem.descricao, quantidade: qtd, enderecoId: endIdDestino, ultimaMovimentacao: serverTimestamp() });
            }
        }
        
        const tipoAcao = (!volOrigem.enderecoId) ? "Entrada/Guardar" : "Logística";
        const p = dbState.produtos[volOrigem.produtoId] || { nome: "" };
        await addDoc(collection(db, "movimentacoes"), { 
            produto: `${p.nome} - ${volOrigem.descricao}`, 
            tipo: tipoAcao, 
            quantidade: qtd, 
            usuario: auth.currentUser.email, 
            data: serverTimestamp(), 
            detalhe: `Para RUA ${endDestino.rua} MOD ${endDestino.modulo}` 
        });
        window.fecharModal(); await syncUI();
    } catch (e) { alert("Erro ao movimentar."); }
}

document.getElementById("btnCriarEndereco").onclick = async () => {
    const rua = document.getElementById("addRua").value.toUpperCase();
    const mod = document.getElementById("addModulo").value;
    const niv = document.getElementById("addNivel").value;
    if (!rua || !mod) return alert("Rua e Módulo obrigatórios!");
    await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv, data: serverTimestamp() });
    syncUI();
};

window.deletarLocal = async (id) => {
    if (confirm("Volumes neste local voltarão para 'Não Endereçados'. Continuar?")) {
        const afetados = dbState.volumes.filter(v => v.enderecoId === id);
        for (let v of afetados) { await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" }); }
        await deleteDoc(doc(db, "enderecos", id));
        syncUI();
    }
};

window.fecharModal = () => { 
    document.getElementById("modalMaster").style.display = "none"; 
    // Reseta o botão para o padrão verde ao fechar
    const btn = document.getElementById("btnConfirmarModal");
    btn.innerText = "CONFIRMAR";
    btn.className = "btn-action btn-success";
};
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
