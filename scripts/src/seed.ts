import bcrypt from "bcryptjs";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const adminHash = bcrypt.hashSync("admin123", 10);
  const staffHash = bcrypt.hashSync("staff123", 10);

  await pool.query(
    `UPDATE users SET password_hash = $1 WHERE username = 'admin'`,
    [adminHash]
  );
  await pool.query(
    `UPDATE users SET password_hash = $1 WHERE username = 'staff1'`,
    [staffHash]
  );

  console.log("Passwords updated: admin/admin123, staff1/staff123");
  await pool.end();
}

seed().catch(console.error);
