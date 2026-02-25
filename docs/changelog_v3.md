# Aimer WT v3更新日志

---

## 新的贡献者

- @kyokusakin
- @TNT569

## 优化

- 优化交互操作（@AimerSo, @Findoutsider）
- 将涂装库、炮镜库、任务库、模型库、机库、自定义文本库移动到副功能界面（@AimerSo）
- 标准化日志输出（@kyokusakin #12）
- 优化压缩包处理，可以处理带密码的压缩包（@AimerSo, @Findoutsider #8）
- 将原本整个可拖动的界面改为仅标题栏可拖动（@Findoutsider #6）
- 支持linux下自动寻找游戏路径（@TNT569 #1）
- 优化炮镜库，可以自己选择UID添加炮镜（@kyokusaki #12）
- 优化语音包安装状态读取逻辑（@Findoutsider #5）
- 语音包现在可以选择模块进行安装，如：只安装陆战语音（@Findoutsider #16）
- 优化涂装库读取逻辑，避免了因为涂装过多导致的界面卡顿（@Findoutsider #16）
- 优化 `.manifest.json` 写逻辑，避免多次安装语音包时覆盖文件导致无法识别已安装的模块（@Findoutsider）

## 新增

- 增加对linux和macOS的支持（@kyokusaki #12， @TNT569 #1）
- 增加遥测功能，以便开发者了解用户使用情况和优化程序（@Findoutsider #16, @AimerSo）
- 新增语音包卡片详细信息界面（@AimerSo）
- 新增语音包试听功能（@Findoutsider）
- 新增任务库、模型库、机库和自定义文本库，可加载玩家自创的任务（@AimerSo，@Findoutsider）
- 新增启动设置，允许开机自启动和最小化到托盘（@AimerSo）

## 修复

- 支持cp950编码（@AimerSo）
- 彻底解决部分场景下的启动白屏问题，提升运行可靠性（@AimerSo）