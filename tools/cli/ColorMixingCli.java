import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.Locale;

/**
 * ColorMixingCli — PBM 一致性测试 CLI（薄包装，无算法实现）
 *
 * 算法实现见 java/ColorMixing.java；本类仅供 tools/check-cross-language.js
 * 调用（stdin 行输入 r1,g1,b1,r2,g2,b2,a，stdout 输出 r,g,b 9 位小数）。
 * 编译：javac -d <build> java/ColorMixing.java tools/cli/ColorMixingCli.java
 * 运行：java -cp <build> ColorMixingCli
 *
 * 许可证：MIT License（仓库 LICENSE）。
 */
public class ColorMixingCli {
    public static void main(String[] args) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
        String line;
        while ((line = reader.readLine()) != null) {
            line = line.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] parts = line.split(",");
            if (parts.length != 7) continue;
            double[] v = new double[7];
            for (int i = 0; i < 7; i++) v[i] = Double.parseDouble(parts[i].trim());
            double[] out = ColorMixing.mixPbm(
                new double[]{v[0], v[1], v[2]}, new double[]{v[3], v[4], v[5]}, v[6]);
            System.out.printf(Locale.ROOT, "%.9f,%.9f,%.9f%n", out[0], out[1], out[2]);
        }
    }
}
