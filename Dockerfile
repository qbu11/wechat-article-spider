# 微信公众号文章爬取工具 Docker 镜像
# 适用于无头服务器环境

FROM python:3.11-slim

LABEL maintainer="qbu11"
LABEL description="WeChat Official Account Article Spider"

# 设置工作目录
WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制项目文件
COPY . /app/

# 安装 Python 依赖
RUN pip install --no-cache-dir -e .

# 创建数据目录
RUN mkdir -p /data

# 设置环境变量
ENV PYTHONUNBUFFERED=1

# 默认入口
ENTRYPOINT ["wechat-spider"]
CMD ["--help"]
