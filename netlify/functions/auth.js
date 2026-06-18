import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { json, parseBody, supabaseAdmin } from './_utils.js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    if (!process.env.JWT_SECRET) {
      return json(500, { error: 'JWT_SECRET 尚未設定' });
    }

    const { username, password } = parseBody(event);
    if (!username || !password) {
      return json(400, { error: '請輸入帳號與密碼' });
    }

    const supabase = supabaseAdmin();
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, password_hash, role')
      .eq('username', username)
      .single();

    if (error || !user) {
      return json(401, { error: '帳號或密碼錯誤' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return json(401, { error: '帳號或密碼錯誤' });
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    return json(200, { token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    return json(500, { error: err.message });
  }
}
