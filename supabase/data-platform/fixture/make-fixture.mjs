// Gera um conjunto SINTÉTICO no layout oficial (sem cabeçalho, ';' como separador, campos entre aspas, ISO-8859-1) com os casos difíceis conhecidos.
// Nenhum dado real. Uso: node make-fixture.mjs <pasta-de-saída>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const out = process.argv[2]; if (!out) { console.error("informe a pasta de saída"); process.exit(1); }
mkdirSync(out, { recursive: true });
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const row = (cols) => cols.map(q).join(";");
const write = (name, rows) => writeFileSync(join(out, name), Buffer.from(rows.map(row).join("\r\n") + "\r\n", "latin1"));   // ISO-8859-1 + CRLF, como a origem

write("Cnaes.csv", [["1091102", "Fabricação de produtos de panificação industrial"], ["8650099", "Atividades de profissionais da área de saúde não especificadas"], ["4721102", "Padaria e confeitaria com predominância de revenda"], ["4729699", "Comércio varejista de produtos alimentícios em geral"], ["4711301", "Comércio varejista de mercadorias em geral, com predominância de produtos alimentícios - hipermercados"]]);
write("Municipios.csv", [["6475", "SANTO ANDRE"], ["6001", "RIO DE JANEIRO"]]);          // 4123 ausente de propósito
write("Naturezas.csv", [["2062", "Sociedade Empresária Limitada"], ["2135", "Empresário (Individual)"]]);
write("Qualificacoes.csv", [["49", "Sócio-Administrador"], ["50", "Empresário"]]);
write("Paises.csv", [["105", "BRASIL"]]); write("Motivos.csv", [["00", "SEM MOTIVO"]]);

write("Empresas1.csv", [
  ["11222333", "PADARIA PÃO QUENTE LTDA", "2062", "49", "150000,50", "03", ""],
  ["12ABC345", 'CLÍNICA ALFA; SAÚDE & CIA "LTDA"', "2062", "49", "1000000,00", "05", ""],     // letras no CNPJ básico; ';' e aspas dentro do campo
  ["99887766", "MERCADO SÃO JOÃO ME", "2135", "50", "0,00", "01", ""],
  ["55544433", "EMPRESA SEM ESTABELECIMENTO", "2062", "49", "abc", "00", ""],                    // capital não numérico -> NULL
]);
const est = (b, o, dv, mat, fant, sit, ini, cnae, sec, uf, mun, ddd, tel, mail) => [b, o, dv, mat, fant, sit, "20200101", "00", "", "", ini, cnae, sec, "RUA", "DAS FLORES", "100", "", "CENTRO", "09010000", uf, mun, ddd, tel, "", "", "", "", mail, "", ""];
write("Estabelecimentos1.csv", [
  est("11222333", "0001", "81", "1", "PÃO QUENTE", "02", "20150310", "1091102", "4721102,4729699", "SP", "6475", "11", "40001234", "CONTATO@PAO.COM.BR"),
  est("12ABC345", "0001", "73", "1", "", "02", "20231201", "8650099", "", "SP", "6475", "", "", ""),
  est("99887766", "0001", "55", "1", "SÃO JOÃO", "08", "00000000", "4711301", "", "RJ", "6001", "21", "22223333", ""),              // baixada + data zerada
  est("99887766", "0002", "36", "2", "SÃO JOÃO FILIAL", "02", "20210231", "4711301", "", "RJ", "6001", "21", "22224444", "FILIAL@SJ.COM"), // data inválida
  est("00000001", "0001", "00", "1", "ORFA", "02", "20190101", "9999999", "", "MG", "4123", "31", "33334444", ""),                  // sem empresa; CNAE e município ausentes das tabelas
]);
write("Socios1.csv", [
  ["11222333", "2", "MARIA APARECIDA DA SILVA", "***123456**", "49", "20150310", "", "***000000**", "", "00", "5"],
  ["11222333", "2", "JOÃO DA SILVA", "***654321**", "22", "20150310", "", "***000000**", "", "00", "6"],
  ["12ABC345", "2", "ANA PAULA SOUZA", "***111222**", "49", "20231201", "", "***000000**", "", "00", "4"],
]);
write("Simples1.csv", [["11222333", "S", "20160101", "00000000", "N", "00000000", "00000000"], ["99887766", "S", "20170101", "00000000", "S", "20170101", "00000000"]]);
console.log("fixture ok em", out);
