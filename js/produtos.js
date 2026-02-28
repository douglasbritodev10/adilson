import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, getDoc,
    updateDoc, query, orderBy, deleteDoc, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let fornecedoresCache = {};
let userRole = "leitor";
let usernameDB = "Usuário";

// --- CONTROLE DE ACESSO E PERSISTÊNCIA ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || user.email.split('@')[0].toUpperCase();
            userRole = data.role || "leitor";
            if(userRole === "admin") document.getElementById("painelCadastro").style.display = "flex";
        }
        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
        
        // Recuperar filtros salvos
        document.getElementById("filtroCod").value = localStorage.getItem("f_cod") || "";
        document.getElementById("filtroDesc").value = localStorage.getItem("f_desc") || "";
        
        await init();
    } else { window.location.href = "index.html"; }
});

async function init() {
    const fSnap = await getDocs(query(collection(db, "fornecedores"), orderBy("nome")));
    const selC = document.getElementById("selForn");
    const selF = document.getElementById("filtroForn");
    
    const fornSalvo = localStorage.getItem("f_forn") || "";

    selC.innerHTML = '<option value="">Escolha o Fornecedor</option>';
    selF.innerHTML = '<option value="">Todos os Fornecedores</option>';

    fSnap.forEach(d => {
        fornecedoresCache[d.id] = d.data().nome;
        const opt = `<option value="${d.id}">${d.data().nome}</option>`;
        selC.innerHTML += opt;
        selF.innerHTML += opt;
    });

    selF.value = fornSalvo;
    refresh();
}

async function refresh() {
    const pSnap = await getDocs(query(collection(db, "produtos"), orderBy("nome")));
    const vSnap = await getDocs(collection(db, "volumes"));
    const tbody = document.getElementById("tblEstoque");
    tbody.innerHTML = "";

    const volumesPorProd = {};
    vSnap.forEach(d => {
        const v = d.data();
        if(!volumesPorProd[v.produtoId]) volumesPorProd[v.produtoId] = [];
        volumesPorProd[v.produtoId].push({id: d.id, ...v});
    });

    pSnap.forEach(d => {
        const p = d.data();
        const pId = d.id;
        const vols = volumesPorProd[pId] || [];
        const totalGeral = vols.reduce((acc, curr) => acc + (curr.quantidade || 0), 0);
        const fornNome = fornecedoresCache[p.fornecedorId] || "---";

        const row = `
            <tr class="prod-row" data-id="${pId}" data-forn="${p.fornecedorId}">
                <td style="text-align:center; cursor:pointer; color:var(--primary);" onclick="window.toggleVols('${pId}')">
                    <i class="fas fa-chevron-right"></i>
                </td>
                <td style="font-weight:bold;">${p.codigo || '---'}</td>
                <td style="color:var(--primary); font-size:12px; font-weight:bold;">${fornNome}</td>
                <td>${p.nome}</td>
                <td style="text-align:center;"><span style="background:#e9ecef; padding:4px 10px; border-radius:15px; font-weight:bold;">${totalGeral}</span></td>
                <td style="text-align:right; padding-right:15px;">
                    <button class="btn btn-add" onclick="window.modalVolume('${pId}', '${p.nome}')" title="Nova Entrada"><i class="fas fa-plus"></i></button>
                    ${userRole === 'admin' ? `
                        <button class="btn btn-edit" onclick="window.editarProduto('${pId}', '${p.nome}', '${p.codigo}')"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-danger" onclick="window.deletar('${pId}', 'produtos', '${p.nome}')"><i class="fas fa-trash"></i></button>
                    ` : ''}
                </td>
            </tr>
        `;
        tbody.innerHTML += row;

        vols.forEach(v => {
            const vRow = `
                <tr class="child-row child-${pId}" data-vcod="${v.codigo}">
                    <td></td>
                    <td style="color:#666; font-size:12px;">SKU: ${v.codigo}</td>
                    <td colspan="2" style="padding-left:30px; color:#555;">${v.descricao}</td>
                    <td style="text-align:center; font-weight:bold; color:var(--success);">${v.quantidade}</td>
                    <td style="text-align:right; padding-right:15px;">
                        ${userRole !== 'leitor' ? `
                            <button class="btn btn-edit" onclick="window.editarVolume('${v.id}', '${v.descricao}', '${v.codigo}')" style="padding:4px 8px;"><i class="fas fa-pen"></i></button>
                            <button class="btn btn-danger" onclick="window.deletar('${v.id}', 'volumes', '${v.descricao}')" style="padding:4px 8px;"><i class="fas fa-trash"></i></button>
                        ` : ''}
                    </td>
                </tr>
            `;
            tbody.innerHTML += vRow;
        });
    });
    window.filtrar();
}

// --- FILTROS PERSISTENTES ---
window.filtrar = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value;
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    // Salvar no localStorage
    localStorage.setItem("f_cod", fCod);
    localStorage.setItem("f_forn", fForn);
    localStorage.setItem("f_desc", fDesc);

    document.querySelectorAll(".prod-row").forEach(row => {
        const pId = row.dataset.id;
        const textoProd = row.innerText.toLowerCase();
        const fornId = row.dataset.forn;
        
        let matchVolume = false;
        document.querySelectorAll(`.child-${pId}`).forEach(vRow => {
            const vTexto = vRow.innerText.toLowerCase();
            const vCod = vRow.dataset.vcod.toLowerCase();
            const showVol = (vTexto.includes(fDesc) && vCod.includes(fCod));
            if(showVol && (fDesc !== "" || fCod !== "")) matchVolume = true;
        });

        const exibir = ( (fForn === "" || fornId === fForn) && 
                         (textoProd.includes(fCod) && textoProd.includes(fDesc) || matchVolume) );
        
        row.style.display = exibir ? "table-row" : "none";
        
        // Se houver busca e bater com o volume, expande automaticamente
        if(exibir && (fCod !== "" || fDesc !== "")) {
            window.toggleVols(pId, true);
        }
    });
};

window.limparFiltros = () => {
    localStorage.removeItem("f_cod");
    localStorage.removeItem("f_forn");
    localStorage.removeItem("f_desc");
    location.reload();
};

// --- AÇÕES DE EDIÇÃO E CADASTRO ---
window.editarProduto = async (id, nome, codigo) => {
    document.getElementById("modalTitle").innerText = "Editar Produto Principal";
    document.getElementById("modalBody").innerHTML = `
        <label>CÓDIGO PRINCIPAL:</label>
        <input type="text" id="editPCod" value="${codigo}">
        <label>NOME DO PRODUTO:</label>
        <input type="text" id="editPNome" value="${nome}">
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = async () => {
        const nNome = document.getElementById("editPNome").value;
        const nCod = document.getElementById("editPCod").value;
        await updateDoc(doc(db, "produtos", id), { nome: nNome, codigo: nCod });
        window.fecharModal();
        refresh();
    };
};

window.editarVolume = async (id, desc, cod) => {
    document.getElementById("modalTitle").innerText = "Editar Cadastro do Volume";
    document.getElementById("modalBody").innerHTML = `
        <label>CÓDIGO DO VOLUME (SKU):</label>
        <input type="text" id="editVCod" value="${cod}">
        <label>DESCRIÇÃO DO VOLUME:</label>
        <input type="text" id="editVDesc" value="${desc}">
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = async () => {
        const nDesc = document.getElementById("editVDesc").value;
        const nCod = document.getElementById("editVCod").value;
        await updateDoc(doc(db, "volumes", id), { descricao: nDesc, codigo: nCod });
        window.fecharModal();
        refresh();
    };
};

window.modalVolume = (pId, pNome) => {
    document.getElementById("modalTitle").innerText = `Entrada de Volume: ${pNome}`;
    document.getElementById("modalBody").innerHTML = `
        <label>CÓDIGO (SKU):</label><input type="text" id="vCod">
        <label>DESCRIÇÃO:</label><input type="text" id="vDesc">
        <label>QUANTIDADE:</label><input type="number" id="vQtd" value="1">
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = async () => {
        const v = {
            produtoId: pId,
            codigo: document.getElementById("vCod").value,
            descricao: document.getElementById("vDesc").value.toUpperCase(),
            quantidade: parseInt(document.getElementById("vQtd").value),
            enderecoId: "", // Vai para pendentes
            dataAlt: serverTimestamp()
        };
        await addDoc(collection(db, "volumes"), v);
        window.fecharModal();
        refresh();
    };
};

window.toggleVols = (pId, forceOpen = false) => {
    const rows = document.querySelectorAll(`.child-${pId}`);
    const icon = document.querySelector(`tr[data-id="${pId}"] i`);
    rows.forEach(r => {
        if(forceOpen) r.classList.add('active');
        else r.classList.toggle('active');
    });
    if(icon) {
        if(rows[0].classList.contains('active')) icon.className = "fas fa-chevron-down";
        else icon.className = "fas fa-chevron-right";
    }
};

window.deletar = async (id, tabela, desc) => {
    if(userRole !== 'admin') return;
    if(confirm(`ATENÇÃO: Deseja excluir permanentemente "${desc}" do banco de dados?`)){
        await deleteDoc(doc(db, tabela, id));
        refresh();
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");

document.getElementById("btnSaveProd").onclick = async () => {
    const n = document.getElementById("newNome").value.toUpperCase();
    const c = document.getElementById("newCod").value;
    const f = document.getElementById("selForn").value;
    if(!n || !f) return alert("Escolha o fornecedor e o nome do produto!");
    await addDoc(collection(db, "produtos"), { nome: n, codigo: c, fornecedorId: f, dataCad: serverTimestamp() });
    document.getElementById("newNome").value = "";
    document.getElementById("newCod").value = "";
    refresh();
};
