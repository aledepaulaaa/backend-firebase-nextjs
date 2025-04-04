// src/pages/api/check-user-token.ts
import { firestoreDb } from '@/lib/firebaseAdmin';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
   if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // Parâmetro vem da query string para GET
  const { email } = req.query;

  if (!email || typeof email !== 'string' || email.length < 3 ) { // Validação básica
    return res.status(400).json({ error: "Email inválido ou não fornecido na query." });
  }

  console.log(`[/api/check-user-token] Verificando tokens para ${email}.`);
  const userDocRef = firestoreDb.collection('token-usuarios').doc(email);

  try {
    const docSnap = await userDocRef.get();
    let userTokens: string[] = [];

    if (docSnap.exists) {
      userTokens = docSnap.data()?.fcmTokens || [];
      console.log(`[/api/check-user-token] Encontrados ${userTokens.length} tokens para ${email}.`);
    } else {
      console.log(`[/api/check-user-token] Nenhum documento encontrado para ${email}.`);
    }

    return res.status(200).json({ tokens: userTokens });

  } catch (error) {
    console.error("[/api/check-user-token] Erro ao buscar tokens no Firestore:", error);
    return res.status(500).json({ error: "Erro interno ao buscar tokens." });
  }
}