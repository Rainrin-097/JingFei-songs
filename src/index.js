export default {
    async fetch(request, env) {
        // 处理 CORS 预检请求
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                },
            });
        }

        // 只允许 POST 请求
        if (request.method !== 'POST') {
            return new Response('仅支持 POST 请求', {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'text/plain; charset=utf-8',
                },
            });
        }

        // 解析用户请求
        const body = await request.json();
        const { userInput, songs } = body;

        if (!userInput || !songs) {
            return new Response(
                JSON.stringify({ error: '缺少 userInput 或 songs 参数' }),
                {
                    status: 400,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Content-Type': 'application/json; charset=utf-8',
                    },
                }
            );
        }

        // 构建发送给 DeepSeek 的消息
        const messages = [
            {
                role: 'system',
                content: `你是一个歌曲匹配助手。用户会描述一个场景或感受，你需要从歌曲列表中找到最匹配的一首。

匹配规则：
1. 优先匹配歌曲的官方描述(official_description)和叙事摘要(ai_narrative_summary)
2. 其次匹配歌词(lyrics)
3. 关注情感氛围(怀旧、孤独、温暖、感伤等)和场景(黄昏、深夜、海边等)
4. 如果用户描述中包含某些关键词，优先匹配有相同关键词的歌曲

请只返回最匹配的那一首歌的 id 号，不要返回其他任何内容。`,
            },
            {
                role: 'user',
                content: `歌曲列表：
${songs}

用户输入：
${userInput}

请返回最匹配的歌曲 id：`,
            },
        ];

        // 调用 DeepSeek API
        try {
            const apiResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`,
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: messages,
                    temperature: 0.3,
                    max_tokens: 50,
                }),
            });

            if (!apiResponse.ok) {
                const error = await apiResponse.text();
                return new Response(
                    JSON.stringify({ error: `AI API 错误: ${error}` }),
                    {
                        status: 502,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Content-Type': 'application/json; charset=utf-8',
                        },
                    }
                );
            }

            const result = await apiResponse.json();
            const songId = parseInt(result.choices[0].message.content.trim());

            return new Response(
                JSON.stringify({ matchedSongId: songId }),
                {
                    status: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Content-Type': 'application/json; charset=utf-8',
                    },
                }
            );
        } catch (error) {
            return new Response(
                JSON.stringify({ error: `请求失败: ${error.message}` }),
                {
                    status: 500,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Content-Type': 'application/json; charset=utf-8',
                    },
                }
            );
        }
    },
};