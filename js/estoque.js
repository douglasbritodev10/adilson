import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { collection, getDocs, doc, getDoc, addDoc, updateDoc, query, orderBy, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };

onAuthStateChanged(auth, async user => {
    if (user) {
        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-circle"></i> ${user.email.split('@')[0].toUpperCase()}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    try {
        const fSnap = await getDocs(collection(db, "fornecedores"));
        fSnap.forEach(d => dbState.fornecedores[d.id] = d.data().nome);

        const pSnap = await getDocs(collection(db, "produtos"));
        pSnap.forEach(d => {
            const p = d.data();
            dbState.produtos[d.id] = { 
                nome: p.nome, 
                codigo: p.codigo || "S/C", 
                forn: dbState.fornecedores[p.fornecedorId] || "---" 
            };
        });
        await syncUI();
    } catch (e) { console.error("Erro ao carregar:", e); }
}

async function syncUI() {
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderPendentes();
    renderEnderecos();
}

function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    if(!grid) return;
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        const totalEnd = vols.reduce((acc, v) => acc + v.quantidade, 0);

        const card = document.createElement('div');
        card.className = "card-endereco";
        // Tag para busca rápida
        card.dataset.busca = vols.map(v => {
            const p = dbState.produtos[v.produtoId] || {};
            return `${p.nome} ${p.forn} ${v.descricao} ${p.codigo}`;
        }).join(' ').toLowerCase();

        card.innerHTML = `
            <div class="card-header">
                <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                <span class="total-end">TOTAL: ${totalEnd}</span>
            </div>
            <div style="overflow-y:auto; flex:1; padding-bottom:10px;">
                ${vols.map(v => {
                    const p = dbState.produtos[v.produtoId] || {nome: "Produto Excluído", codigo: "---", forn: "---"};
                    return `
                    <div class="vol-item">
                        <div class="forn-name">${p.forn}</div>
                        <div class="prod-info">${p.nome} <small style="color:var(--primary)">[${p.codigo}]</small></div>
                        <div class="vol-info">
                            <b>Volume:</b> ${v.descricao} <br>
                            <b>Cód. Vol:</b> ${v.codigoVol || '---'}
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                            <span style="font-weight:bold; font-size:14px;">QTD: <span style="color:var(--success)">${v.quantidade}</span></span>
                            <button onclick="window.abrirMover('${v.id}')" style="cursor:pointer; background:var(--primary); color:white; border:none; padding:4px 8px; border-radius:4px; font-size:10px;">MOVER</button>
                        </div>
                    </div>`;
                }).join('') || '<p style="text-align:center; font-size:12px; color:#999; padding:20px;">Vazio</p>'}
            </div>`;
        grid.appendChild(card);
    });
}

window.abrirMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    if(!vol) return;

    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Guardar / Mover";
    document.getElementById("modalBody").innerHTML = `
        <div style="background:#f0f4f8; padding:10px; border-radius:6px; font-size:13px; margin-bottom:10px;">
            <b>${vol.descricao}</b><br>Disponível: ${vol.quantidade}
        </div>
        <label>Endereço de Destino:</label>
        <select id="selDestino">
            <option value="">Selecione...</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
        </select>
        <label>Quantidade:</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" min="1" max="${vol.quantidade}">
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmarModal").onclick = async () => {
        const destId = document.getElementById("selDestino").value;
        const qtd = parseInt(document.getElementById("qtdMover").value);

        if(!destId || isNaN(qtd) || qtd <= 0 || qtd > vol.quantidade) return alert("Verifique os dados!");

        // SOMA INTELIGENTE: Verifica se o mesmo produto/volume já existe no destino
        const destinoMesmoItem = dbState.volumes.find(v => 
            v.enderecoId === destId && v.produtoId === vol.produtoId && v.descricao === vol.descricao
        );

        try {
            if(destinoMesmoItem) {
                // Se já existe no endereço, soma no destino
                await updateDoc(doc(db, "volumes", destinoMesmoItem.id), { quantidade: increment(qtd) });
            } else {
                // Se não existe, cria novo registro naquele endereço
                await addDoc(collection(db, "volumes"), {
                    produtoId: vol.produtoId, descricao: vol.descricao, 
                    codigoVol: vol.codigoVol || "", quantidade: qtd, enderecoId: destId,
                    dataMov: serverTimestamp()
                });
            }
            // Subtrai da origem
            await updateDoc(doc(db, "volumes", vol.id), { quantidade: increment(-qtd) });
            
            modal.style.display = "none";
            syncUI();
        } catch(e) { alert("Erro ao salvar!"); }
    };
};

window.criarEndereco = async () => {
    const rua = document.getElementById("addRua").value.toUpperCase();
    const mod = document.getElementById("addModulo").value;
    if(!rua || !mod) return alert("Preencha Rua e Módulo!");
    await addDoc(collection(db, "enderecos"), { rua, modulo: mod });
    document.getElementById("addRua").value = "";
    document.getElementById("addModulo").value = "";
    syncUI();
};

window.filtrarEstoque = () => {
    const termo = document.getElementById("filtroDesc").value.toLowerCase();
    document.querySelectorAll(".card-endereco").forEach(card => {
        card.style.display = card.dataset.busca.includes(termo) ? "flex" : "none";
    });
};

function renderPendentes() {
    const area = document.getElementById("pendentesArea");
    area.innerHTML = "";
    dbState.volumes.filter(v => v.quantidade > 0 && (!v.enderecoId || v.enderecoId === "")).forEach(v => {
        const p = dbState.produtos[v.produtoId] || {nome: "---"};
        area.innerHTML += `
            <div class="vol-item" style="background:white; border-left-color:var(--warning)">
                <div style="font-size:11px; font-weight:bold;">${p.nome}</div>
                <div style="font-size:12px;">${v.descricao} (<b>${v.quantidade}</b>)</div>
                <button onclick="window.abrirMover('${v.id}')" style="width:100%; margin-top:5px; cursor:pointer;">GUARDAR</button>
            </div>`;
    });
}

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
