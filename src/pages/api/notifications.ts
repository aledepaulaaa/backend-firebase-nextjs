// notifications.ts
import { runCorsMiddleware } from '@/lib/cors'
import { firestoreDb } from '@/lib/firebaseAdmin'
import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const { method } = req

    // Executar o middleware CORS
    await runCorsMiddleware(req, res)

    switch (method) {
        case 'GET':
            return checkUserToken(req, res)
        case 'POST':
            return registerToken(req, res)
        case 'DELETE':
            return deleteToken(req, res)
        default:
            res.setHeader('Allow', ['GET', 'POST', 'DELETE'])
            res.status(405).end(`Method ${method} Not Allowed`)
    }
}

// Verificar se um token existe para o usuário e dispositivo
async function checkUserToken(req: NextApiRequest, res: NextApiResponse) {
    try {
        const { email, deviceId } = req.query

        if (!email) {
            return res.status(400).json({ error: 'Email é obrigatório' })
        }

        const userDocRef = firestoreDb.collection('token-usuarios').doc(email as string)
        const userDoc = await userDocRef.get()

        if (!userDoc.exists) {
            return res.status(200).json({ hasValidToken: false })
        }

        const userData = userDoc.data()
        const tokens = userData?.fcmTokens || []

        // Se fornecido deviceId, verifica token específico para o dispositivo
        if (deviceId) {
            const deviceToken = tokens.find((t: any) => t.deviceId === deviceId)
            return res.status(200).json({
                hasValidToken: !!deviceToken,
                token: deviceToken?.token || null
            })
        }

        // Sem deviceId, retorna o primeiro token válido
        return res.status(200).json({
            hasValidToken: tokens.length > 0,
            token: tokens.length > 0 ? tokens[0].token : null
        })

    } catch (error) {
        console.error('Erro ao verificar token:', error)
        return res.status(500).json({ error: 'Erro ao verificar token' })
    }
}

// Registrar novo token
async function registerToken(req: NextApiRequest, res: NextApiResponse) {
    try {
        const { fcmToken, email, deviceId = 'default' } = req.body

        console.log({ 
            "Token ": fcmToken,
            "Email ": email,
            "DeviceId ": deviceId,
        })

        if (!fcmToken || !email || !deviceId) {
            return res.status(400).json({ error: 'Token e email e deviceId são obrigatórios' })
        }

        const userDocRef = firestoreDb.collection('token-usuarios').doc(email)
        const userDoc = await userDocRef.get()

        if (!userDoc.exists) {
            // Criar novo documento para o usuário
            await userDocRef.set({
                fcmTokens: [{ fcmToken, deviceId, createdAt: new Date() }]
            })
        } else {
            // Atualizar documento existente
            const userData = userDoc.data()
            let tokens = userData?.fcmTokens || []

            // Verificar se já existe um token para este dispositivo
            const existingTokenIndex = tokens.findIndex((t: any) => t.deviceId === deviceId)

            if (existingTokenIndex >= 0) {
                // Atualizar token existente
                tokens[existingTokenIndex] = {
                    fcmToken,
                    deviceId,
                    updatedAt: new Date(),
                    createdAt: tokens[existingTokenIndex].createdAt
                }
            } else {
                // Adicionar novo token
                tokens.push({ fcmToken, deviceId, createdAt: new Date() })
            }

            await userDocRef.update({ fcmTokens: tokens })
        }

        return res.status(200).json({ success: true })

    } catch (error) {
        console.error('Erro ao registrar token:', error)
        return res.status(500).json({ error: 'Erro ao registrar token' })
    }
}

// Deletar token
async function deleteToken(req: NextApiRequest, res: NextApiResponse) {
    try {
        const { token, email, deviceId } = req.body

        if (!email) {
            return res.status(400).json({ error: 'Email é obrigatório' })
        }

        const userDocRef = firestoreDb.collection('token-usuarios').doc(email)
        const userDoc = await userDocRef.get()

        if (!userDoc.exists) {
            // Nada a fazer se o documento não existe
            return res.status(200).json({ success: true })
        }

        const userData = userDoc.data()
        let tokens = userData?.fcmTokens || []

        // Filtragem baseada nos parâmetros fornecidos
        if (deviceId) {
            // Remove token específico do dispositivo
            tokens = tokens.filter((t: any) => t.deviceId !== deviceId)
        } else if (token) {
            // Remove token específico
            tokens = tokens.filter((t: any) => t.token !== token)
        } else {
            // Se nenhum critério específico, mantém os tokens
            return res.status(400).json({ error: 'Token ou deviceId é necessário para remoção' })
        }

        // Atualiza o documento com a nova lista de tokens
        await userDocRef.update({ fcmTokens: tokens })

        return res.status(200).json({ success: true })

    } catch (error) {
        console.error('Erro ao remover token:', error)
        return res.status(500).json({ error: 'Erro ao remover token' })
    }
}