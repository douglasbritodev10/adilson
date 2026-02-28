import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let usernameDB = "Usuário";
let userRole = "leitor"; // Nível mais baixo por padrão

// --- CONTROLE DE ACESSO ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || "Usuário";
            userRole = data.role || "leitor";
            
            // Regra: Apenas Admin cadastra endereços
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
        const [fSnap, pSnap, eSnap, vSnap] = await Promise.all([
            getDocs(collection(db, "fornecedores")),
            getDocs(collection(db, "produtos")),
            getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo"))),
            getDocs(collection(db, "volumes"))
        ]);

        dbState.fornecedores = {};
        fSnap.forEach(d => dbState.fornecedores[d.id] = { nome: d.data().nome, codigo: d.data().codigo || "S/C" });
        
        dbState.produtos = {};
        pSnap.forEach(d => dbState.produtos[d.id] = { 
            nome: d.data().nome, 
            codigo: d.data().codigo || "S/C", 
            fornecedorId: d.data().fornecedorId 
        });

        dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const selForn = document.getElementById("filtroForn");
        if(selForn) {
            selForn.innerHTML = '<option value="">Todos os Fornecedores</option>';
            const nomes = [...new Set(Object.values(dbState.fornecedores).map(f => f.nome))].sort();
            nomes.forEach(n => selForn.innerHTML += `<option value="${n}">${n}</option>`);
        }

        syncUI();
    } catch (e) { console.error("Erro no loadAll:", e); }
}

function syncUI() {
    const grid = document.getElementById("gridEnderecos");
    const pendentes = document.getElementById("listaPendentes");
    if(!grid || !pendentes) return;

    grid.innerHTML = "";
    pendentes.innerHTML = "";

    // 1. LISTA PENDENTES (Apenas se não for Leitor)
    const falta = dbState.volumes.filter(v => (!v.enderecoId || v.enderecoId === "") && v.quantidade > 0);
    document.getElementById("countPendentes").innerText = falta.length;

    falta.forEach(v => {
        const prod = dbState.produtos[v.produtoId] || { nome: "???", codigo: "???", fornecedorId: "" };
        const forn = dbState.fornecedores[prod.fornecedorId] || { nome: "???", codigo: "???" };
        
        const div = document.createElement("div");
        div.className = "item-pendente";
        div.innerHTML = `
            <small><b>[${forn.codigo}] ${forn.nome}</b></small><br>
            <b>${v.descricao}</b><br>
            <small>SKU: ${prod.codigo} | Qtd: ${v.quantidade}</small>
            ${userRole !== 'leitor' ? `<button onclick="window.abrirAcao('${v.id}', 'guardar')" class="btn" style="background:var(--success); color:white; width:100%; margin-top:5px; padding:4px; font-size:10px;">GUARDAR</button>` : ''}
        `;
        pendentes.appendChild(div);
    });

    // 2. GRID DE ENDEREÇOS
    dbState.enderecos.forEach(e => {
        const vols = dbState.volumes.filter(v => v.enderecoId === e.id && v.quantidade > 0);
        const card = document.createElement("div");
        card.className = "card-endereco";
        
        let totalItens = 0;
        let htmlItens = "";
        let buscaTexto = `${e.rua} ${e.modulo} ${e.nivel} `.toLowerCase();

        vols.forEach(v => {
            const prod = dbState.produtos[v.produtoId] || { nome: "???", codigo: "???", fornecedorId: "" };
            const forn = dbState.fornecedores[prod.fornecedorId] || { nome: "???", codigo: "???" };
            totalItens += v.quantidade;
            buscaTexto += `${prod.nome} ${prod.codigo} ${forn.nome} ${v.descricao} `.toLowerCase();

            htmlItens += `
                <div class="item-row">
                    <div class="item-info">
                        <b style="color:var(--primary)">${v.quantidade}x</b> ${v.descricao}<br>
                        <span style="font-size:9px; color:#666;">F: ${forn.nome} | C: ${prod.codigo}</span>
                    </div>
                    ${userRole !== 'leitor' ? `
                        <div style="display:flex;">
                            <button onclick="window.abrirAcao('${v.id}', 'mover')" class="btn-mini" style="background:var(--info)" title="Mover"><i class="fas fa-exchange-alt"></i></button>
                            <button onclick="window.abrirAcao('${v.id}', 'saida')" class="btn-mini" style="background:var(--danger)" title="Saída"><i class="fas fa-sign-out-alt"></i></button>
                        </div>
                    ` : ''}
                </div>
            `;
        });

        card.dataset.busca = buscaTexto;
        card.innerHTML = `
            <div class="card-header">
                RUA ${e.rua} - MOD ${e.modulo} - NIV ${e.nivel}
                ${userRole === 'admin' ? `<button onclick="window.deletarEndereco('${e.id}')" class="btn-delete-end"><i class="fas fa-trash"></i></button>` : ''}
            </div>
            <div class="card-body">${htmlItens || '<small style="color:#ccc">Vazio</small>'}</div>
            <div class="card-footer">Total: ${totalItens} un</div>
        `;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

// --- MODAL ÚNICO PARA TODAS AS AÇÕES (Guardar, Mover, Saída) ---
window.abrirAcao = (volId, tipo) => {
    if(userRole === 'leitor') return;

    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    const title = document.getElementById("modalTitle");
    const body = document.getElementById("modalBody");
    
    body.innerHTML = `
        <p style="font-size:13px; background:#f9f9f9; padding:10px; border-radius:5px;">
            Item: <b>${vol.descricao}</b><br>Saldo Atual: <b>${vol.quantidade}</b>
        </p>
        <label>QUANTIDADE PARA AÇÃO:</label>
        <input type="number" id="qtdAcao" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="width:100%; margin-bottom:15px;">
    `;

    if (tipo === 'guardar' || tipo === 'mover') {
        title.innerText = tipo === 'guardar' ? "Endereçar Produto" : "Mover entre Endereços";
        let opts = dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} - NIV ${e.nivel}</option>`).join('');
        body.innerHTML += `<label>DESTINO:</label><select id="selDestino" style="width:100%;">${opts}</select>`;
    } else {
        title.innerText = "Dar Saída (Venda/Cliente)";
        body.innerHTML += `<p style="color:var(--danger); font-size:11px;">* Esta ação removerá as peças do estoque permanentemente.</p>`;
    }

    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const qtd = parseInt(document.getElementById("qtdAcao").value);
        if(qtd <= 0 || qtd > vol.quantidade) return alert("Quantidade inválida!");

        try {
            if (tipo === 'saida') {
                // Registrar Movimentação e descontar
                await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd), ultimaMovimentacao: serverTimestamp() });
                await addDoc(collection(db, "historico"), { 
                    tipo: "SAÍDA", volume: vol.descricao, qtd, usuario: usernameDB, data: serverTimestamp() 
                });
            } else {
                const destinoId = document.getElementById("selDestino").value;
                if(qtd === vol.quantidade) {
                    await updateDoc(doc(db, "volumes", volId), { enderecoId: destinoId, ultimaMovimentacao: serverTimestamp() });
                } else {
                    // Split (Move parte e mantém o resto onde estava ou pendente)
                    await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) });
                    await addDoc(collection(db, "volumes"), {
                        produtoId: vol.produtoId, descricao: vol.descricao, quantidade: qtd, 
                        enderecoId: destinoId, ultimaMovimentacao: serverTimestamp()
                    });
                }
            }
            window.fecharModal(); loadAll();
        } catch (err) { alert("Erro ao processar!"); }
    };
};

// --- FUNÇÕES DE ADMIN ---
window.abrirNovoEndereco = () => {
    if(userRole !== 'admin') return;
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Novo Endereço";
    document.getElementById("modalBody").innerHTML = `
        <input type="text" id="nRua" placeholder="Rua (Ex: A)" style="width:100%; margin-bottom:10px;">
        <input type="number" id="nMod" placeholder="Módulo" style="width:100%; margin-bottom:10px;">
        <input type="number" id="nNiv" placeholder="Nível (Ex: 1)" style="width:100%;">
    `;
    modal.style.display = "flex";
    document.getElementById("btnConfirmar").onclick = async () => {
        const rua = document.getElementById("nRua").value.trim().toUpperCase();
        const mod = document.getElementById("nMod").value;
        const niv = document.getElementById("nNiv").value || "1";
        if(!rua || !mod) return alert("Dados incompletos!");
        await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv });
        window.fecharModal(); loadAll();
    };
};

window.deletarEndereco = async (id) => {
    if(userRole !== 'admin') return;
    if(confirm("Deseja excluir este endereço? Os itens contidos nele voltarão para a lista de PENDENTES.")){
        const afetados = dbState.volumes.filter(v => v.enderecoId === id);
        for(let v of afetados) { 
            await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" }); 
        }
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};

// --- UTILITÁRIOS ---
window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod")?.value.toLowerCase() || "";
    const fForn = document.getElementById("filtroForn")?.value.toLowerCase() || "";
    const fDesc = document.getElementById("filtroDesc")?.value.toLowerCase() || "";
    let c = 0;

    document.querySelectorAll(".card-endereco").forEach(card => {
        const busca = card.dataset.busca || "";
        const match = busca.includes(fCod) && busca.includes(fDesc) && (fForn === "" || busca.includes(fForn));
        card.style.display = match ? "flex" : "none";
        if(match) c++;
    });
    document.getElementById("countDisplay").innerText = c;
};

window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    window.filtrarEstoque();
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
