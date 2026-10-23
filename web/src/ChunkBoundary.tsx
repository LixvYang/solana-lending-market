/** INPUT: 懒加载的子组件。 OUTPUT: 加载失败时的局部降级。 POSITION: 资产页图表外层。 */
import { Component, type ReactNode } from 'react';

/**
 * 懒加载的图表文件下载失败(网络抖动，或用户停留期间站点重新部署、旧文件已不存在)时，
 * 没有边界会让整个 React 树卸载、整页空白。这里只把出错的那一块换成一行提示和重试。
 */
export class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <p className="muted">图表加载失败 <button className="linkish" onClick={() => location.reload()}>重新加载</button></p>;
  }
}
