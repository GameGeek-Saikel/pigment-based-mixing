// color_mixing_cli.cpp — PBM 一致性测试 CLI（薄包装，无算法实现）
//
// 算法实现见 cpp/color_mixing.h；本文件仅供 tools/check-cross-language.js
// 调用（stdin 行输入 r1,g1,b1,r2,g2,b2,a，stdout 输出 r,g,b 9 位小数）。
// 编译（g++）：g++ -O2 -std=c++17 -I cpp -o <build>/color_mixing_cli tools/cli/color_mixing_cli.cpp
// 编译（MSVC）：cl /nologo /O2 /std:c++17 /EHsc /I cpp /Fo<build>/ /Fe<build>/color_mixing_cli.exe tools/cli/color_mixing_cli.cpp
//
// 许可证：MIT License（仓库 LICENSE）。

#include "color_mixing.h"

#include <cstdio>
#include <string>
#include <vector>

int main() {
  std::string line;
  char buf[1024];
  while (std::fgets(buf, sizeof(buf), stdin) != nullptr) {
    line = buf;
    size_t b = line.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) continue;
    size_t e = line.find_last_not_of(" \t\r\n");
    line = line.substr(b, e - b + 1);
    if (line.empty() || line[0] == '#') continue;
    std::vector<double> v;
    size_t pos = 0;
    while (pos <= line.size()) {
      size_t comma = line.find(',', pos);
      if (comma == std::string::npos) comma = line.size();
      v.push_back(std::stod(line.substr(pos, comma - pos)));
      pos = comma + 1;
      if (v.size() == 7) break;
    }
    if (v.size() != 7) continue;
    const color_mixing::Vec3 out = color_mixing::mix_pbm(
        {v[0], v[1], v[2]}, {v[3], v[4], v[5]}, v[6]);
    std::printf("%.9f,%.9f,%.9f\n", out[0], out[1], out[2]);
  }
  return 0;
}
