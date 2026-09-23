import { describe, expect, it } from "vitest";
import { brl, parseCents, toCsv } from "./format";
import { validateSlug } from "./reserved-slugs";
import { safeUrl, videoEmbed } from "@/features/pages/blocks";

describe("dinheiro em centavos", () => {
  it("formata sem ponto flutuante", () => {
    expect(brl(123456)).toBe("R$ 1.234,56");
    expect(brl(5)).toBe("R$ 0,05");
    expect(brl(-1050)).toBe("-R$ 10,50");
    expect(brl(null)).toBe("—");
  });
  it("converte texto para centavos inteiros", () => {
    expect(parseCents("1.234,56")).toBe(123456);
    expect(parseCents("10")).toBe(1000);
    expect(parseCents("0,5")).toBe(50);
    expect(parseCents("R$ 99,99")).toBe(9999);
  });
  it("rejeita entradas inválidas", () => {
    expect(parseCents("abc")).toBeNull();
    expect(parseCents("1,234")).toBeNull();
    expect(parseCents("-5")).toBeNull();
    expect(parseCents("")).toBeNull();
  });
  it("0,1 + 0,2 não vira 0,30000000000000004", () => {
    expect(parseCents("0,10")! + parseCents("0,20")!).toBe(30);
  });
});

describe("slugs de páginas", () => {
  it("aceita endereços válidos", () => { expect(validateSlug("checkup")).toBeNull(); expect(validateSlug("pos-operatorio")).toBeNull(); });
  it("bloqueia rotas reservadas", () => {
    for (const s of ["admin", "login", "academy", "api", "redefinir-senha", "portal"]) expect(validateSlug(s)).not.toBeNull();
  });
  it("bloqueia formato inválido", () => {
    for (const s of ["", "Com Espaço", "a/b", "-x", "x-", "x--y", "MAIUSCULA"]) expect(validateSlug(s)).not.toBeNull();
  });
});

describe("links e vídeos seguros no editor de blocos", () => {
  it("bloqueia esquemas perigosos", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>")).toBeNull();
    expect(safeUrl("//evil.com")).toBeNull();
  });
  it("permite https, caminho interno, âncora, mailto e tel", () => {
    for (const u of ["https://hp.com.br", "/checkup", "#formulario", "mailto:a@b.co", "tel:+5511999999999"]) expect(safeUrl(u)).toBe(u);
  });
  it("só embute YouTube/Vimeo por endereço construído por nós", () => {
    expect(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbed("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbed("https://vimeo.com/123456")).toBe("https://player.vimeo.com/video/123456");
    expect(videoEmbed("https://evil.com/embed/x")).toBeNull();
    expect(videoEmbed("http://youtube.com/watch?v=abcdefghijk")).toBeNull();
  });
});

describe("exportação CSV", () => {
  it("escapa aspas, separadores e neutraliza fórmulas", () => {
    const csv = toCsv([{ nome: 'Ana "A"; B', obs: "=HYPERLINK(1)" }]);
    expect(csv).toContain('"Ana ""A""; B"');
    expect(csv).toContain("'=HYPERLINK(1)");
  });
});
