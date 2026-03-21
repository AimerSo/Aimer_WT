# 此文件为机密配置模板
# 请将此文件重命名为 app_secrets.py 并填入实际值
# 注意：app_secrets.py 已被加入 .gitignore，请勿将其上传到版本控制系统

# 遥测服务器上报地址
REPORT_URL = "https://api.example.com/telemetry"

# 遥测客户端签名密钥
# - 客户端（app_secrets.py）与服务端（环境变量 TELEMETRY_CLIENT_SECRET）保持一致
# - 留空时仍可本地兼容旧版/无密钥测试，但正式环境强烈建议配置
TELEMETRY_CLIENT_SECRET = ""
