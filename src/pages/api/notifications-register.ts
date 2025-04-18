// src/pages/api/notifications-register.ts
import type { NextApiRequest, NextApiResponse } from "next"
import * as admin from "firebase-admin"
import { firestoreDb } from "@/lib/firebaseAdmin"
import { runCorsMiddleware } from "@/lib/cors"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Executar o middleware CORS
    await runCorsMiddleware(req, res)

    if (req.method !== "POST") {
        res.setHeader("Allow", ["POST"])
        return res.status(405).end(`Método ${req.method} não permitido`)
    }

    // Extrair dados do corpo da requisição
    const { fcmToken, email } = req.body

    // Validação básica
    if (!fcmToken || !email) {
        return res.status(400).json({
            error: "Token FCM e email são obrigatórios",
            registered: false
        })
    }

    try {
        // Registrar o token no Firestore - usando a coleção token-usuarios para compatibilidade
        const userDocRef = firestoreDb.collection("token-usuarios").doc(email)

        // Verificar se o documento existe
        const docSnap = await userDocRef.get()

        if (docSnap.exists) {
            // Adicionar o token ao array existente, evitando duplicatas
            await userDocRef.update({
                fcmTokens: admin.firestore.FieldValue.arrayUnion(fcmToken),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            })
        } else {
            // Criar novo documento
            await userDocRef.set({
                fcmTokens: [fcmToken],
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            })
        }

        return res.status(200).json({
            registered: true,
            message: "Token registrado com sucesso para notificações em segundo plano"
        })
    } catch (error: any) {
        console.error("Erro ao registrar token:", error)
        return res.status(500).json({
            error: "Erro interno ao registrar token",
            details: error.message
        })
    }
}

