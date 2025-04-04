// src/pages/api/delete-token.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { firestoreDb } from '../../lib/firebaseAdmin' // Ajuste o caminho
import * as admin from 'firebase-admin' // Import FieldValue

// Helper de validação
const isValidInput = (token: any, email: any): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return typeof token === 'string' && token.length > 10 &&
        typeof email === 'string' && email.length > 3 && emailRegex.test(email)
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST'])
        return res.status(405).end(`Method ${req.method} Not Allowed`)
    }

    const { fcmToken, email } = req.body

    console.log(`[/api/delete-token] Recebido: token=${fcmToken?.substring(0, 10)}..., email=${email}`)

    if (!isValidInput(fcmToken, email)) {
        console.log("[/api/delete-token] Input inválido (token ou email).")
        return res.status(400).json({ error: "Token FCM ou Email inválido." })
    }

    const userDocRef = firestoreDb.collection('token-usuarios').doc(email)

    try {
        // Firestore `arrayRemove` não falha se o item ou documento não existir.
        // No entanto, não sabemos se algo foi realmente removido sem ler antes/depois.
        // Para manter a lógica original (saber se removeu), lemos primeiro.
        const docSnap = await userDocRef.get()
        let tokenExisted = false

        if (docSnap.exists) {
            const currentTokens: string[] = docSnap.data()?.fcmTokens || []
            if (currentTokens.includes(fcmToken)) {
                tokenExisted = true
                await userDocRef.update({
                    fcmTokens: admin.firestore.FieldValue.arrayRemove(fcmToken)
                })
                console.log(`[/api/delete-token] Token removido para ${email}.`)

                // Opcional: Remover o documento se o array de tokens ficar vazio
                // Adicione essa lógica se for importante para você
                const updatedSnap = await userDocRef.get() // Ler novamente após remover
                if (updatedSnap.exists && updatedSnap.data()?.fcmTokens?.length === 0) {
                    console.log(`[/api/delete-token] Array de tokens vazio para ${email}, removendo documento.`)
                    await userDocRef.delete()
                }

            } else {
                console.log(`[/api/delete-token] Token não encontrado na lista para ${email}. Nenhuma alteração.`)
            }
        } else {
            console.log(`[/api/delete-token] Email ${email} não encontrado no DB.`)
        }

        // Responde de forma similar ao original
        if (tokenExisted) {
            return res.status(200).json({ message: "Token desregistrado com sucesso." })
        } else {
            return res.status(200).json({ message: "Token ou email não encontrado, nada a fazer." })
        }

    } catch (error) {
        console.error("[/api/delete-token] Erro ao interagir com Firestore:", error)
        return res.status(500).json({ error: "Erro interno ao atualizar o estado do token." })
    }
}