import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, query, orderBy, serverTimestamp, increment 
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
        if(display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
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

        // Preencher filtro de fornecedor (Protegido)
        const selForn = document.getElementById("filtroForn");
        if(selForn) {
            selForn.innerHTML = '<option value="">Todos os Fornecedores</option>';
            const nomes = Object.values(dbState.fornecedores).map(f => f.nome).sort();
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

    // 1. LISTA FALTA GUARDAR (Apenas Qtd > 0 e sem endereço)
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
            <small>Cód: ${prod.codigo} | Qtd: ${v.quantidade}</small>
            <button onclick="window.abrirGuardar('${v.id}')" class="btn" style="background:var(--success); color:white; width:100%; margin-top:5px; padding:4px;">GUARDAR</button>
        `;
        pendentes.appendChild(div);
    });

    // 2. GRID DE ENDEREÇOS
    dbState.enderecos.forEach(e => {
        const vols = dbState.volumes.filter(v => v.enderecoId === e.id && v.quantidade > 0);
        const card = document.createElement("div");
        card.className = "card-endereco";
        
        let totalNoEndereco = 0;
        let htmlItens = "";
        let buscaTexto = `${e.rua} ${e.modulo} ${e.nivel} `.toLowerCase();

        vols.forEach(v => {
            const prod = dbState.produtos[v.produtoId] || { nome: "???", codigo: "???", fornecedorId: "" };
            const forn = dbState.fornecedores[prod.fornecedorId] || { nome: "???", codigo: "???" };
            totalNoEndereco += v.quantidade;
            buscaTexto += `${prod.nome} ${prod.codigo} ${forn.nome} ${forn.codigo} ${v.descricao} `.toLowerCase();

            htmlItens += `
                <div style="border-bottom:1px solid #f0f0f0; padding:4px 0;">
                    <b style="color:var(--primary)">${v.quantidade}x</b> ${v.descricao}<br>
                    <span style="font-size:9px; color:#666;">Forn: ${forn.nome} | SKU: ${prod.codigo}</span>
                </div>
            `;
        });

        card.dataset.busca = buscaTexto;
        card.innerHTML = `
            <div class="card-header">RUA ${e.rua} - MOD ${e.modulo} - NIV ${e.nivel}</div>
            <div class="card-body">${htmlItens || '<small style="color:#ccc">Vazio</small>'}</div>
            <div class="card-footer">Total: ${totalNoEndereco} un</div>
        `;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

// --- LÓGICA DE GUARDAR COM DESMEMBRAMENTO ---
window.abrirGuardar = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Endereçar";
    
    let opts = dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} - NIV ${e.nivel}</option>`).join('');
    
    document.getElementById("modalBody").innerHTML = `
        <p style="font-size:13px;">Produto: <b>${vol.descricao}</b><br>Disponível: <b>${vol.quantidade}</b></p>
        <label>QUANTIDADE A GUARDAR:</label>
        <input type="number" id="qtdAcao" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="width:100%;">
        <label style="display:block; margin-top:10px;">ENDEREÇO:</label>
        <select id="selDestino" style="width:100%;">${opts}</select>
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const destinoId = document.getElementById("selDestino").value;
        const qtd = parseInt(document.getElementById("qtdAcao").value);

        if(qtd <= 0 || qtd > vol.quantidade) return alert("Qtd Inválida");

        if(qtd === vol.quantidade) {
            await updateDoc(doc(db, "volumes", volId), { enderecoId: destinoId, ultimaMovimentacao: serverTimestamp() });
        } else {
            // Split (Desmembramento)
            await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) });
            await addDoc(collection(db, "volumes"), {
                produtoId: vol.produtoId, descricao: vol.descricao, quantidade: qtd, 
                enderecoId: destinoId, ultimaMovimentacao: serverTimestamp()
            });
        }
        window.fecharModal(); loadAll();
    };
};

// --- NOVO ENDEREÇO ---
window.abrirNovoEndereco = () => {
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Novo Endereço";
    document.getElementById("modalBody").innerHTML = `
        <input type="text" id="nRua" placeholder="Rua (Ex: A)" style="width:100%; margin-bottom:10px;">
        <input type="number" id="nMod" placeholder="Módulo" style="width:100%; margin-bottom:10px;">
        <input type="number" id="nNiv" placeholder="Nível" style="width:100%;">
    `;
    modal.style.display = "flex";
    document.getElementById("btnConfirmar").onclick = async () => {
        const rua = document.getElementById("nRua").value.trim().toUpperCase();
        const mod = document.getElementById("nMod").value;
        const niv = document.getElementById("nNiv").value || "1";
        if(!rua || !mod) return alert("Preencha Rua e Módulo!");
        
        const existe = dbState.enderecos.find(e => e.rua === rua && e.modulo === mod && e.nivel === niv);
        if(existe) return alert("Endereço já cadastrado!");

        await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv });
        window.fecharModal(); loadAll();
    };
};

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
    const disp = document.getElementById("countDisplay");
    if(disp) disp.innerText = c;
};

window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    window.filtrarEstoque();
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
