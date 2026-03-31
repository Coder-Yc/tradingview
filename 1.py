import asyncio
import ssl
import websockets
import msgpack

TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NTYsImVtYWlsIjoieWFuZ2Nob25nNDM0QGdtYWlsLmNvbSIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzc0OTU3NzMzLCJleHAiOjE3NzU1NjI1MzN9.atKllqHGDdhEw1W-pQyzNTfvOVndWp3c2K2YQ5dzJpI"
URL = f"wss://nexflow-tech.xyz/ws?token={TOKEN}"

async def main():
    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    async with websockets.connect(
        URL,
        ssl=ssl_ctx,
        extra_headers={
            "Origin": "https://nexflow-tech.xyz",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        }
    ) as ws:
        print("已连接")
        print(f"连接状态: {ws.open}")

        messages_to_send = [
            # 订阅 K线
            {"type": "subscribe", "channel": "candles", "params": {
                "exchange": "databento", "symbol": "GC", "timeframe": "5m", "candleCount": 500
            }},
            # 订阅聚合订单
            {"type": "subscribe", "channel": "clustered_orders", "params": {
                "exchange": "databento", "symbol": "GC", "timeframe": "5m",
                "minNotional": 50000, "lookbackCandles": 500
            }},
            # 订阅大单
            {"type": "subscribe", "channel": "big_trades", "params": {
                "exchange": "databento", "symbol": "GC", "timeframe": "5m",
                "bigTradeThreshold": 50000, "lookbackCandles": 500
            }},
            # 订阅订单簿
            {"type": "subscribe", "channel": "orderbook", "params": {
                "exchange": "databento", "symbol": "GC", "timeframe": "5m", "candleCount": 500
            }},
        ]

        for msg in messages_to_send:
            await ws.send(msgpack.packb(msg, use_bin_type=True))
            print(f"已发送: {msg['type']}")
        try:
            async for message in ws:
                print(f"收到消息，类型: {type(message)}, 长度: {len(message)}")
                if isinstance(message, bytes):
                    try:
                        data = msgpack.unpackb(message, raw=False)
                        print(data)
                    except Exception as e:
                        print(f"解析失败: {e}, raw: {message.hex()}")
                else:
                    print(f"文本消息: {message}")
        except websockets.exceptions.ConnectionClosed as e:
            print(f"连接已关闭: code={e.code}, reason={e.reason}")

asyncio.run(main())