#!/usr/bin/env node
// Seed script — insere usuário admin padrão e configurações iniciais
// Uso: DATABASE_URL=... node scripts/src/seed.mjs

import pg from "pg";
import { createHash } from "crypto";

const { Client } = pg;

// Gerar hash bcrypt manualmente usando o módulo bcryptjs
// (sem depender do workspace compilado)
async function loadBcrypt() {
  try {
    const mod = await import("bcryptjs");
    return mod.default ?? mod;
  } catch {
    // fallback: tentar caminho do workspace
    const mod = await import("../../node_modules/bcryptjs/dist/bcrypt.js");
    return mod.default ?? mod;
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌  DATABASE_URL não definido");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const bcrypt = await loadBcrypt();

    // ── Usuário admin ──────────────────────────────────────────────────────────
    const existing = await client.query(
      "SELECT id FROM users WHERE username = $1",
      ["admin"]
    );

    if (existing.rows.length === 0) {
      const hash = await bcrypt.hash("admin123", 10);
      await client.query(
        "INSERT INTO users (username, password_hash) VALUES ($1, $2)",
        ["admin", hash]
      );
      console.log("✓ Usuário admin criado (senha: admin123)");
    } else {
      console.log("✓ Usuário admin já existe — pulando");
    }

    // ── Configurações padrão ───────────────────────────────────────────────────
    const settingsExist = await client.query("SELECT id FROM settings LIMIT 1");
    if (settingsExist.rows.length === 0) {
      await client.query(`
        INSERT INTO settings (
          check_interval_seconds,
          ping_attempts,
          ping_timeout_ms,
          failures_before_offline
        ) VALUES (120, 3, 3000, 3)
      `);
      console.log("✓ Configurações padrão criadas");
    } else {
      console.log("✓ Configurações já existem — pulando");
    }

    console.log("✅  Seed concluído com sucesso!");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("❌  Erro no seed:", err.message);
  process.exit(1);
});
