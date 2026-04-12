# unet.py
# Enhanced UNet with Attention Gates + ASPP bottleneck for small cell detection
# Base: https://github.com/michalprusek/cell-segmentation-hub

import torch
import torch.nn as nn
import torch.nn.functional as F


def get_norm_layer(num_features, use_instance_norm=True):
    if use_instance_norm:
        return nn.InstanceNorm2d(num_features, affine=True)
    else:
        return nn.BatchNorm2d(num_features)


class DoubleConv(nn.Module):
    def __init__(self, in_channels, out_channels, use_instance_norm=True, dropout=0.0):
        super(DoubleConv, self).__init__()
        self.double_conv = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1, bias=False),
            get_norm_layer(out_channels, use_instance_norm),
            nn.ReLU(inplace=True),
            nn.Dropout2d(p=dropout) if dropout > 0 else nn.Identity(),
            nn.Conv2d(out_channels, out_channels, kernel_size=3, padding=1, bias=False),
            get_norm_layer(out_channels, use_instance_norm),
            nn.ReLU(inplace=True),
        )

    def forward(self, x):
        return self.double_conv(x)


class AttentionGate(nn.Module):
    """Additive attention gate for skip connections (Oktay et al., 2018).

    Suppresses irrelevant background activations in encoder features
    while preserving small cell signals, using decoder context as gating signal.
    """

    def __init__(self, F_g, F_l, F_int):
        super().__init__()
        self.W_g = nn.Sequential(
            nn.Conv2d(F_g, F_int, kernel_size=1, bias=True),
            get_norm_layer(F_int),
        )
        self.W_x = nn.Sequential(
            nn.Conv2d(F_l, F_int, kernel_size=1, bias=True),
            get_norm_layer(F_int),
        )
        self.psi = nn.Sequential(
            nn.Conv2d(F_int, 1, kernel_size=1, bias=True),
            nn.Sigmoid(),
        )
        self.relu = nn.ReLU(inplace=True)

    def forward(self, g, x):
        g1 = self.W_g(g)
        x1 = self.W_x(x)
        if g1.shape[2:] != x1.shape[2:]:
            g1 = F.interpolate(g1, size=x1.shape[2:], mode="bilinear", align_corners=False)
        psi = self.relu(g1 + x1)
        psi = self.psi(psi)
        return x * psi


class ASPPBottleneck(nn.Module):
    """Atrous Spatial Pyramid Pooling bottleneck (DeepLab v3+).

    Replaces standard DoubleConv bottleneck with multi-scale context
    via parallel dilated convolutions. Helps discriminate small cells from noise
    by capturing context at multiple receptive field sizes.
    """

    def __init__(self, in_channels, out_channels, rates=(1, 2, 4, 6),
                 use_instance_norm=True, dropout=0.15):
        super().__init__()
        mid = out_channels // (len(rates) + 1)

        self.branches = nn.ModuleList()
        for r in rates:
            self.branches.append(nn.Sequential(
                nn.Conv2d(in_channels, mid,
                          kernel_size=1 if r == 1 else 3,
                          padding=0 if r == 1 else r,
                          dilation=r, bias=False),
                get_norm_layer(mid, use_instance_norm),
                nn.ReLU(inplace=True),
            ))

        # GAP branch — no norm (1×1 spatial breaks both InstanceNorm and BatchNorm)
        self.gap = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Conv2d(in_channels, mid, 1, bias=True),
            nn.ReLU(inplace=True),
        )

        total_mid = mid * (len(rates) + 1)
        self.project = nn.Sequential(
            nn.Conv2d(total_mid, out_channels, 1, bias=False),
            get_norm_layer(out_channels, use_instance_norm),
            nn.ReLU(inplace=True),
            nn.Dropout2d(dropout),
        )

    def forward(self, x):
        h, w = x.shape[2:]
        feats = [b(x) for b in self.branches]
        gap = F.interpolate(self.gap(x), size=(h, w), mode="bilinear", align_corners=False)
        return self.project(torch.cat(feats + [gap], dim=1))


class UNet(nn.Module):
    """Enhanced UNet with Attention Gates on skip connections and ASPP bottleneck.

    Compatible with pretrained weights from standard UNet (strict=False loading).
    New modules (attention_gates, aspp_bottleneck) initialize with Kaiming.
    """

    def __init__(
        self,
        in_channels=3,
        out_channels=1,
        features=[64, 128, 256, 512, 1024],
        use_instance_norm=True,
        dropout_rate=0.1,
        use_deep_supervision=False,
        use_attention_gates=True,
        use_aspp=True,
    ):
        super(UNet, self).__init__()

        self.use_instance_norm = use_instance_norm
        self.use_deep_supervision = use_deep_supervision
        self.use_attention_gates = use_attention_gates

        # Initial convolution
        self.init_conv = DoubleConv(in_channels, features[0], use_instance_norm, dropout=0)

        # Encoder path
        self.downs = nn.ModuleList()
        self.pools = nn.ModuleList()
        for i in range(len(features) - 1):
            self.downs.append(
                DoubleConv(features[i], features[i + 1], use_instance_norm,
                           dropout=dropout_rate if i > 0 else 0)
            )
            self.pools.append(nn.MaxPool2d(kernel_size=2, stride=2))

        # Bottleneck — ASPP or standard DoubleConv
        if use_aspp:
            self.bottleneck = ASPPBottleneck(
                features[-2], features[-1], use_instance_norm=use_instance_norm,
                dropout=dropout_rate * 1.5,
            )
        else:
            self.bottleneck = DoubleConv(
                features[-2], features[-1], use_instance_norm, dropout=dropout_rate * 1.5
            )

        # Decoder path
        reversed_features = list(reversed(features))
        self.ups = nn.ModuleList()
        self.decoder_blocks = nn.ModuleList()
        for i in range(len(reversed_features) - 1):
            self.ups.append(
                nn.ConvTranspose2d(reversed_features[i], reversed_features[i + 1],
                                   kernel_size=2, stride=2)
            )
            self.decoder_blocks.append(
                DoubleConv(reversed_features[i], reversed_features[i + 1],
                           use_instance_norm, dropout=dropout_rate)
            )

        # Attention gates on skip connections
        if use_attention_gates:
            self.attention_gates = nn.ModuleList()
            for i in range(len(reversed_features) - 1):
                F_g = reversed_features[i + 1]  # upsampled decoder channels
                F_l = reversed_features[i + 1]  # encoder skip channels
                F_int = F_l // 2
                self.attention_gates.append(AttentionGate(F_g, F_l, F_int))

        # Final output
        self.final_conv = nn.Conv2d(features[0], out_channels, kernel_size=1)

        # Deep supervision
        if use_deep_supervision:
            self.deep_outputs = nn.ModuleList([
                nn.Conv2d(features[i], out_channels, kernel_size=1)
                for i in range(len(features) - 1)
            ])

        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, (nn.BatchNorm2d, nn.InstanceNorm2d)):
                if m.weight is not None:
                    nn.init.constant_(m.weight, 1)
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)

    def forward(self, x):
        input_size = x.shape[2:]

        x = self.init_conv(x)
        skip_connections = [x]

        for pool, down in zip(self.pools[:-1], self.downs[:-1]):
            x = pool(skip_connections[-1])
            x = down(x)
            skip_connections.append(x)

        # Bottleneck
        x = self.pools[-1](skip_connections[-1])
        x = self.bottleneck(x)

        skip_connections = skip_connections[::-1]

        # Decoder with attention gates
        deep_outputs = []
        for i, (up, decoder_block) in enumerate(zip(self.ups, self.decoder_blocks)):
            x = up(x)
            skip = skip_connections[i]

            if x.shape[2:] != skip.shape[2:]:
                x = F.interpolate(x, size=skip.shape[2:], mode="bilinear", align_corners=False)

            # Apply attention gate before concatenation
            if self.use_attention_gates:
                skip = self.attention_gates[i](g=x, x=skip)

            x = torch.cat([skip, x], dim=1)
            x = decoder_block(x)

            if self.use_deep_supervision and self.training and i < len(self.deep_outputs):
                deep_out = self.deep_outputs[len(self.deep_outputs) - 1 - i](x)
                deep_out = F.interpolate(deep_out, size=input_size, mode="bilinear", align_corners=False)
                deep_outputs.append(deep_out)

        x = self.final_conv(x)
        if x.shape[2:] != input_size:
            x = F.interpolate(x, size=input_size, mode="bilinear", align_corners=False)

        if self.use_deep_supervision and self.training:
            return x, deep_outputs
        return x
