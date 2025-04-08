// src/pages/api/savetoken.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import * as admin from 'firebase-admin' // Import FieldValue
import { firestoreDb } from '@/lib/firebaseAdmin'
import { runCorsMiddleware } from '@/lib/cors'

// Helper de validação (similar ao original)
const isValidInput = (token: any, email: any): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return typeof token === 'string' && token.length > 10 &&
        typeof email === 'string' && email.length > 3 && emailRegex.test(email)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {

    // Executar o middleware CORS
    await runCorsMiddleware(req, res)

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST'])
        return res.status(405).end(`Method ${req.method} Not Allowed`)
    }

    // Extrair dados do corpo da requisição
    const { fcmToken, email } = req.body

    console.log(`[/api/savetoken] Recebido: token=${fcmToken ? fcmToken.substring(0, 10) + '...' : 'undefined'}, email=${email || 'undefined'}`)

    // Validação mais rigorosa
    if (!fcmToken || !email) {
        console.error("[/api/savetoken] Token ou email ausente:", { fcmToken: !!fcmToken, email: !!email })
        return res.status(400).json({
            error: "Token FCM ou Email ausente na requisição.",
            registered: false,
            details: {
                hasToken: !!fcmToken,
                hasEmail: !!email
            }
        })
    }

    if (!isValidInput(fcmToken, email)) {
        console.log("[/api/savetoken] Input inválido (token ou email).")
        return res.status(400).json({ error: "Token FCM ou Email inválido.", registered: false })
    }

    try {
        // Usa o email como ID do documento para fácil consulta
        const userDocRef = firestoreDb.collection('token-usuarios').doc(email)

        const docSnap = await userDocRef.get()
        let message = ""

        if (docSnap.exists) {
            // Documento (usuário) já existe
            const currentTokens: string[] = docSnap.data()?.fcmTokens || []
            if (currentTokens.includes(fcmToken)) {
                message = "Token já estava registrado para este email."
                console.log(`[/api/savetoken] Token já existe para ${email}. Nenhuma alteração.`)
                // Token já existe, retorna sucesso mas não precisa escrever
                return res.status(200).json({ message: message, registered: true })
            } else {
                // Adiciona o novo token ao array existente
                await userDocRef.update({
                    fcmTokens: admin.firestore.FieldValue.arrayUnion(fcmToken)
                })
                // Adiciona o novo token ao array existente
                await userDocRef.update({
                    fcmTokens: admin.firestore.FieldValue.arrayUnion(fcmToken)
                })
                message = "Novo token adicionado para este email."
                console.log(`[/api/savetoken] Novo token adicionado para ${email}.`)
            }
        } else {
            // Novo documento (usuário)
            await userDocRef.set({
                fcmTokens: [fcmToken],
                // Você pode adicionar outros campos aqui se precisar, ex: data de criação
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            })
            message = "Novo email e token registrados."
            console.log(`[/api/savetoken] Novo email (${email}) e token registrados.`)
        }

        return res.status(200).json({
            message: message,
            registered: true,
            email: email,
            tokenPrefix: fcmToken.substring(0, 10) + '...'
        })

    } catch (error: any) {
        console.error("[/api/savetoken] Erro ao interagir com Firestore:", error)

        // Resposta de erro mais detalhada
        return res.status(500).json({
            error: "Erro interno ao salvar token.",
            registered: false,
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        })
    }
}